import type { PageServerLoad } from "./$types";
import { error } from "@sveltejs/kit";
import providers from "$lib/providers";

type Excluded = {
    shows: string[];
    movies: string[];
    infohashes: string[];
    infohash_labels?: Record<string, string>;
};

/**
 * Per-item stream blacklist (`StreamBlacklistRelation`) — patch 0038's
 * `GET /api/v1/items/blacklisted_streams`. Unrelated to the global
 * `excluded_items.infohashes` list rendered by the sections above: this one is
 * written automatically by patch 0002 on every RD 451 and was invisible until
 * now. Server-paginated because it runs to hundreds of rows.
 */
export type BlacklistedStream = {
    relation_id: number;
    stream_id: number;
    infohash: string;
    raw_title: string;
    parsed_title: string | null;
    rank: number | null;
    resolution: string | null;
    flagged_451_services: string[];
};

export type BlacklistedGroup = {
    item_id: number;
    title: string;
    type: string;
    state: string | null;
    poster_path: string | null;
    root_id: number | null;
    root_type: string | null;
    root_title: string | null;
    tvdb_id: string | null;
    tmdb_id: string | null;
    imdb_id: string | null;
    count: number;
    newest_relation_id: number;
    streams: BlacklistedStream[];
};

export type BlacklistedPage = {
    success: boolean;
    page: number;
    limit: number;
    total_items: number;
    total_pages: number;
    total_relations: number;
    hidden_451: number;
    items: BlacklistedGroup[];
};

/**
 * Page sizes offered by the selector. 100 is the ceiling because patch 0038
 * declares `limit` as `Query(ge=1, le=100)` — asking for more is a 422, so
 * there is deliberately no "all" option.
 */
const PER_ITEM_PAGE_SIZES = [25, 50, 100];
const PER_ITEM_DEFAULT_PAGE_SIZE = 25;

function parsePageSize(raw: string | null): number {
    const n = Number(raw);
    return PER_ITEM_PAGE_SIZES.includes(n) ? n : PER_ITEM_DEFAULT_PAGE_SIZE;
}

type ResolvedItem = {
    externalId: string;
    rivenId?: string;
    title?: string;
    posterPath?: string;
    type: "show" | "movie";
};

async function resolveItem(
    externalId: string,
    mediaType: "tv" | "movie",
    baseUrl: string,
    apiKey: string,
    fetch: typeof globalThis.fetch,
    tvdbToken?: string
): Promise<Partial<ResolvedItem>> {
    try {
        const res = await providers.riven.GET("/api/v1/items/{id}", {
            params: {
                path: { id: externalId },
                query: { media_type: mediaType }
            },
            baseUrl,
            headers: { "x-api-key": apiKey },
            fetch
        });
        if (!res.error && res.data) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const d = res.data as any;
            return {
                rivenId: d.id ? String(d.id) : undefined,
                title: d.title,
                posterPath: d.poster_path ?? undefined
            };
        }
    } catch {
        /* fall through to metadata fallback */
    }

    // Not in the Riven library DB → fall back to TVDB metadata so the blocklist
    // shows a real title instead of "Show <id>". Only works for a valid tvdb id
    // (a legacy mis-namespaced tmdb id stored under shows will 404 here → stays
    // a bare label until the entry is corrected).
    if (mediaType === "tv" && tvdbToken && /^\d+$/.test(externalId)) {
        try {
            const res = await providers.tvdb.GET("/series/{id}", {
                params: { path: { id: Number(externalId) } },
                headers: { Authorization: `Bearer ${tvdbToken}` },
                fetch
            });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const d = (res.data as any)?.data;
            if (d?.name) {
                return { title: d.name, posterPath: d.image ?? undefined };
            }
        } catch {
            /* leave unresolved */
        }
    }
    return {};
}

export const load: PageServerLoad = async ({ fetch, locals, cookies, url }) => {
    const tvdbToken = cookies.get("tvdb_cookie") || "";
    const settingsResp = await fetch(
        `${locals.backendUrl}/api/v1/settings/get/filesystem.excluded_items`,
        { headers: { "x-api-key": locals.apiKey } }
    );
    if (!settingsResp.ok) {
        error(500, `Failed to read excluded_items (HTTP ${settingsResp.status})`);
    }
    const settingsJson = await settingsResp.json();
    const raw = settingsJson?.["filesystem.excluded_items"] as Excluded | undefined;
    if (!raw) {
        error(500, "Failed to read excluded_items");
    }

    const excluded: Excluded = {
        shows: raw.shows ?? [],
        movies: raw.movies ?? [],
        infohashes: raw.infohashes ?? [],
        infohash_labels: raw.infohash_labels ?? {}
    };

    const shows: ResolvedItem[] = await Promise.all(
        excluded.shows.map(async (id) => ({
            externalId: id,
            type: "show" as const,
            ...(await resolveItem(id, "tv", locals.backendUrl, locals.apiKey, fetch, tvdbToken))
        }))
    );

    const movies: ResolvedItem[] = await Promise.all(
        excluded.movies.map(async (id) => ({
            externalId: id,
            type: "movie" as const,
            ...(await resolveItem(id, "movie", locals.backendUrl, locals.apiKey, fetch))
        }))
    );

    const infohashes = excluded.infohashes.map((hash) => ({
        hash,
        label: excluded.infohash_labels?.[hash] ?? null
    }));

    // --- per-item stream blacklist (patch 0038) --------------------------------
    // The URL is still the source of truth (so a page/search/toggle/size stays
    // shareable and survives a reload), but this loader only produces the FIRST
    // page. Subsequent paging is a client-side fetch through the backend proxy
    // that rewrites the URL with `replaceState` — see +page.svelte. Re-running
    // this loader to change one section's page cost ~530ms, ~400ms of which was
    // re-resolving the *global* shows/movies titles above (a Riven lookup plus a
    // TVDB round trip for anything not in the Riven DB, measured up to 1.6s on a
    // slow TVDB response) — work that cannot change when only `blPage` moves.
    // Params are prefixed `bl*` to avoid colliding with anything else on the route.
    const perItemPage = Math.max(1, Math.trunc(Number(url.searchParams.get("blPage")) || 1));
    const perItemQuery = (url.searchParams.get("blQ") ?? "").trim();
    const perItemShow451 = url.searchParams.get("bl451") === "1";
    const perItemPageSize = parsePageSize(url.searchParams.get("blSize"));

    const perItemParams = new URLSearchParams({
        page: String(perItemPage),
        limit: String(perItemPageSize)
    });
    if (perItemQuery) perItemParams.set("search", perItemQuery);
    if (perItemShow451) perItemParams.set("include_451", "true");

    let perItem: BlacklistedPage | null = null;
    let perItemError: string | null = null;

    try {
        const resp = await fetch(
            `${locals.backendUrl}/api/v1/items/blacklisted_streams?${perItemParams}`,
            { headers: { "x-api-key": locals.apiKey } }
        );
        if (resp.status === 404) {
            // Backend patch 0038 not deployed yet — degrade to a notice rather
            // than 500-ing the whole page (the global sections still work).
            perItemError = "unsupported";
        } else if (!resp.ok) {
            perItemError = `HTTP ${resp.status}`;
        } else {
            perItem = (await resp.json()) as BlacklistedPage;
        }
    } catch (e) {
        perItemError = e instanceof Error ? e.message : String(e);
    }

    return {
        shows,
        movies,
        infohashes,
        perItem,
        perItemError,
        perItemPage,
        perItemQuery,
        perItemShow451,
        perItemPageSize,
        perItemPageSizes: PER_ITEM_PAGE_SIZES,
        perItemDefaultPageSize: PER_ITEM_DEFAULT_PAGE_SIZE
    };
};
