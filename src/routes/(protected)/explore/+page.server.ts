import { superValidate } from "sveltekit-superforms/server";
import { zod4 } from "sveltekit-superforms/adapters";
import { searchSchema } from "$lib/schemas/search";
import type { PageServerLoad } from "./$types";
import { parseSearchQuery } from "$lib/search-parser";

/**
 * /explore is the app's search results page — the header search bar, the mobile
 * nav and ⌘K all navigate here with `?query=`.
 *
 * It used to also render a landing "empty state" (a rotating TMDB hero, a
 * Feeling Lucky button and trending suggestions), which cost six TMDB list
 * requests on every single visit and duplicated the home page. Worse, the type
 * tabs did nothing while it was showing: the page keys the empty state off
 * "no query and no filters", so selecting Movies/TV/People visibly changed
 * nothing. Removed 2026-08-24 — the page is now just search.
 */
export const load: PageServerLoad = async ({ url }) => {
    const form = await superValidate(url.searchParams, zod4(searchSchema));

    return {
        form,
        parsed: parseSearchQuery(form.data.query || "")
    };
};
