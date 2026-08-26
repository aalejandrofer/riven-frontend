import { json } from "@sveltejs/kit";
import providers from "$lib/providers";
import { TMDB_IMAGE_BASE_URL } from "$lib/providers";
import type { RequestHandler } from "./$types";
import type { operations } from "$lib/providers/tmdb";

type JsonBody<O extends keyof operations> =
    operations[O]["responses"][200]["content"]["application/json"];

/**
 * The generated TMDB spec does not model `append_to_response` sub-resources on the
 * details operations, so compose them from the standalone operations that DO model
 * them. Every appended key is optional: TMDB omits it when it has nothing to append.
 */
type MovieDetailsWithAppends = JsonBody<"movie-details"> & {
    images?: Pick<JsonBody<"movie-images">, "logos">;
    release_dates?: Pick<JsonBody<"movie-release-dates">, "results">;
};

type SeriesDetailsWithAppends = JsonBody<"tv-series-details"> & {
    images?: Pick<JsonBody<"tv-series-images">, "logos">;
    content_ratings?: Pick<JsonBody<"tv-series-content-ratings">, "results">;
};

/** Movie and series logo entries are structurally identical in the spec. */
type TMDBLogos = NonNullable<JsonBody<"movie-images">["logos"]>;

function pickLogoUrl(logos: TMDBLogos | undefined): string | null {
    const chosen = logos?.find((logo) => logo.iso_639_1 === "en") ?? logos?.[0];
    // `file_path` is optional in the spec — without this guard a logo entry that
    // carries none would build the URL ".../w500undefined".
    return chosen?.file_path ? `${TMDB_IMAGE_BASE_URL}/w500${chosen.file_path}` : null;
}

export const GET: RequestHandler = async ({ params, fetch }) => {
    const { type, id } = params;

    if (!type || !id || (type !== "movie" && type !== "tv")) {
        return json({ error: "Invalid type or id" }, { status: 400 });
    }

    try {
        if (type === "movie") {
            const { data, error } = await providers.tmdb.GET("/3/movie/{movie_id}", {
                fetch,
                params: {
                    path: { movie_id: Number(id) },
                    query: { append_to_response: "images,release_dates" }
                }
            });

            if (error || !data) {
                return json({ logo: null, certification: null });
            }

            const movie = data as MovieDetailsWithAppends;
            const usRelease = movie.release_dates?.results?.find((r) => r.iso_3166_1 === "US");
            // `release_dates` on a country entry is optional — the old code indexed it
            // unconditionally and would throw on a US entry that carries no dates.
            const certification =
                usRelease?.release_dates?.find((d) => d.certification)?.certification ?? null;

            return json({ logo: pickLogoUrl(movie.images?.logos), certification });
        }

        const { data, error } = await providers.tmdb.GET("/3/tv/{series_id}", {
            fetch,
            params: {
                path: { series_id: Number(id) },
                query: { append_to_response: "images,content_ratings" }
            }
        });

        if (error || !data) {
            return json({ logo: null, certification: null });
        }

        const series = data as SeriesDetailsWithAppends;
        const usRating = series.content_ratings?.results?.find((r) => r.iso_3166_1 === "US");

        return json({
            logo: pickLogoUrl(series.images?.logos),
            certification: usRating?.rating ?? null
        });
    } catch (e) {
        console.error("Error fetching logo:", e);
        return json({ logo: null }, { status: 500 });
    }
};
