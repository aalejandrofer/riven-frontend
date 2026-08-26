import type { PageServerLoad } from "./$types";
import providers from "$lib/providers";
import { parsePersonDetails, parseCompanyDetails, transformTMDBList } from "$lib/providers/parser";
import { error } from "@sveltejs/kit";
import { createCustomFetch, type CustomFetch } from "$lib/custom-fetch";
import { createScopedLogger } from "$lib/logger";

const logger = createScopedLogger("entity");

// TVDB remote-source type ids (GET /v4/sources/types), one per record kind.
const TMDB_SOURCE_TYPES = new Set([10, 12, 15, 28]);
const IMDB_SOURCE_TYPES = new Set([2, 16, 17]);

type ProviderError = { message?: string; status_message?: string };

function providerErrorMessage(err: unknown, fallback: string): string {
    const e = (err ?? {}) as ProviderError;
    return e.message || e.status_message || fallback;
}

function fetchTMDBPerson(personId: number, customFetch: CustomFetch) {
    return providers.tmdb.GET("/3/person/{person_id}", {
        params: {
            path: { person_id: personId },
            query: { append_to_response: "combined_credits,external_ids" }
        },
        fetch: customFetch
    });
}

/**
 * ID-NAMESPACE BRIDGE (see plex/debrid/CLAUDE.md "ID namespaces are MIXED").
 *
 * A TV detail page is built from TVDB (`parseTVDBShowDetails`), so its cast rows
 * carry **TVDB people ids**, while this route only speaks TMDB. Feeding a TVDB
 * people id to `/3/person/{person_id}` 404s (e.g. 300292 = Kyle Chandler on TVDB,
 * nothing on TMDB). Movie pages are TMDB-built and are unaffected.
 *
 * TVDB `people/{id}/extended` carries `remoteIds`, so the mapping already exists
 * and needs no guessing: read the TheMovieDB entry, else cross over via the IMDb
 * entry with TMDB `/3/find`. Runs ONLY after TMDB has already missed, so the
 * normal (movie) path costs nothing extra.
 *
 * Note: TMDB `/3/find/{id}?external_source=tvdb_id` is NOT a shortcut here — it
 * never returns `person_results`, and a people id can collide with a series id
 * (300292 resolves to an unrelated TV show), so it would silently be wrong.
 */
async function resolveTvdbPersonToTmdb(
    tvdbPersonId: number,
    tvdbToken: string,
    customFetch: CustomFetch
): Promise<{ tmdbId: number | null; name: string | null }> {
    const tvdbRes = await providers.tvdb.GET("/people/{id}/extended", {
        params: { path: { id: tvdbPersonId } },
        headers: { Authorization: `Bearer ${tvdbToken}` },
        fetch: customFetch
    });

    const person = tvdbRes.data?.data;
    if (!person) {
        return { tmdbId: null, name: null };
    }

    const name = person.name ?? null;
    const remoteIds = person.remoteIds ?? [];

    // TVDB /sources/types reuses one name across several numeric ids (TheMovieDB.com
    // is 10/12/15/28, IMDB is 2/16/17 — one per record kind), so match the name and
    // keep the numeric ids only as a backstop.
    const tmdbRemote = remoteIds.find(
        (remote) =>
            (remote.sourceName ?? "").toLowerCase().includes("themoviedb") ||
            TMDB_SOURCE_TYPES.has(remote.type ?? -1)
    );
    const tmdbId = Number(tmdbRemote?.id);
    if (Number.isFinite(tmdbId) && tmdbId > 0) {
        return { tmdbId, name };
    }

    // ~5% of TVDB people have no TheMovieDB remoteId but do have an IMDb one;
    // TMDB can resolve that to a person.
    const imdbRemote = remoteIds.find(
        (remote) =>
            ((remote.sourceName ?? "").toLowerCase().includes("imdb") ||
                IMDB_SOURCE_TYPES.has(remote.type ?? -1)) &&
            /^nm\d+$/.test(remote.id ?? "")
    );
    if (imdbRemote?.id) {
        const findRes = await providers.tmdb.GET("/3/find/{external_id}", {
            params: {
                path: { external_id: imdbRemote.id },
                query: { external_source: "imdb_id" }
            },
            fetch: customFetch
        });
        const people = (findRes.data?.person_results ?? []) as { id?: number }[];
        const foundId = Number(people[0]?.id);
        if (Number.isFinite(foundId) && foundId > 0) {
            return { tmdbId: foundId, name };
        }
    }

    return { tmdbId: null, name };
}

export const load: PageServerLoad = async ({ fetch, params, cookies }) => {
    const { id, type } = params;
    const customFetch = createCustomFetch(fetch);

    if (!id || isNaN(Number(id))) {
        error(400, "Invalid ID");
    }

    if (type === "person") {
        let personRes = await fetchTMDBPerson(Number(id), customFetch);
        let tvdbName: string | null = null;

        if (personRes.error) {
            // Miss path only: maybe this is a TVDB people id from a TV cast row.
            const tvdbToken = cookies.get("tvdb_cookie");
            if (tvdbToken) {
                try {
                    const { tmdbId, name } = await resolveTvdbPersonToTmdb(
                        Number(id),
                        tvdbToken,
                        customFetch
                    );
                    tvdbName = name;

                    if (tmdbId && tmdbId !== Number(id)) {
                        const retryRes = await fetchTMDBPerson(tmdbId, customFetch);
                        if (!retryRes.error) {
                            logger.info(`TVDB person ${id} -> TMDB ${tmdbId} (${name ?? "?"})`);
                            personRes = retryRes;
                        } else {
                            logger.warn(
                                `TVDB person ${id} mapped to TMDB ${tmdbId} but TMDB still failed`
                            );
                        }
                    }
                } catch (err) {
                    logger.warn(`TVDB fallback for person ${id} failed: ${String(err)}`);
                }
            }
        }

        if (personRes.error) {
            const detail = providerErrorMessage(personRes.error, "Failed to fetch person details");
            if (personRes.response?.status === 404) {
                // Name the person when TVDB knew who they were — a bare 500 tells
                // the user nothing, and this is a dead end, not a server fault.
                const notFound = tvdbName
                    ? `${tvdbName} (TVDB person ${id}) has no TheMovieDB entry.`
                    : `Person ${id} could not be found on TheMovieDB or TheTVDB.`;
                error(404, notFound);
            }
            error(500, detail);
        }

        return {
            entity: parsePersonDetails(personRes.data)
        };
    } else if (type === "company") {
        const [companyRes, moviesRes, showsRes] = await Promise.all([
            providers.tmdb.GET("/3/company/{company_id}", {
                params: { path: { company_id: Number(id) } },
                fetch: customFetch
            }),
            providers.tmdb.GET("/3/discover/movie", {
                params: {
                    query: {
                        with_companies: String(id),
                        sort_by: "popularity.desc"
                    }
                },
                fetch: customFetch
            }),
            providers.tmdb.GET("/3/discover/tv", {
                params: {
                    query: {
                        with_companies: String(id),
                        sort_by: "popularity.desc"
                    }
                },
                fetch: customFetch
            })
        ]);

        const companyResUnknown = companyRes as { error?: { message?: string } };
        if (companyResUnknown.error) {
            error(500, companyResUnknown.error.message || "Failed to fetch company details");
        }

        const movies = transformTMDBList(moviesRes.data?.results ?? [], "movie");
        const shows = transformTMDBList(showsRes.data?.results ?? [], "tv");

        return {
            entity: parseCompanyDetails(companyRes.data, movies, shows)
        };
    } else {
        error(404, "Invalid entity type");
    }
};
