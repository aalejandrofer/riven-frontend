import * as z from "zod";
import type { operations } from "$lib/providers/riven";

const typeEnum = z.enum(["movie", "show", "season", "episode", "anime"]);
const stateEnum = z.enum([
    "All",
    "Unknown",
    "Unreleased",
    "Ongoing",
    "Requested",
    "Indexed",
    "Scraped",
    "Downloaded",
    "Symlinked",
    "Completed",
    "PartiallyCompleted",
    "Failed",
    "Paused",
    "Excluded"
]);
const sortEnum = z.enum(["title_asc", "title_desc", "date_asc", "date_desc"]);

export const itemsSearchSchema = z.object({
    limit: z.coerce
        .number<number>()
        .min(1, "Limit must be at least 1")
        .max(100, "Limit must be at most 100")
        .optional()
        .default(24),
    page: z.coerce.number<number>().min(1, "Page must be at least 1").optional().default(1),
    type: z
        .array(typeEnum)
        .min(1, "At least one type must be selected")
        .optional()
        .default(["movie", "show"]),
    states: z
        .array(stateEnum)
        .min(1, "At least one state must be selected")
        .optional()
        .default(["All"]),
    sort: z
        .array(sortEnum)
        .min(1, "At least one sort option must be selected")
        .optional()
        .default(["date_desc"]),
    search: z.string().min(1, "Search term must be at least 1 character").optional()
});

export type ItemsSearchSchema = z.infer<typeof itemsSearchSchema>;

/** Query parameters `GET /api/v1/items` accepts, per the generated Riven client. */
export type ItemsQuery = NonNullable<operations["get_items"]["parameters"]["query"]>;

/**
 * The same query, widened by the one state the generated client does not know about.
 *
 * `stateEnum` above offers `Excluded`, a state this fork added (patches 0012/0014/0015).
 * `src/lib/providers/riven.ts` was generated before that, so its `States` union has no
 * `Excluded` — yet the live backend accepts it: `GET /api/v1/items?states=Excluded` answers
 * 200 with rows whose `state` is `"Excluded"`. Callers should build their query object
 * against this type (so every OTHER parameter stays checked) and assert to `ItemsQuery`
 * once, at the openapi-fetch call. Delete both aliases the day `riven.ts` is regenerated
 * against the patched backend.
 */
export type ItemsQueryWithExcluded = Omit<ItemsQuery, "states"> & {
    states?: (NonNullable<ItemsQuery["states"]>[number] | "Excluded")[];
};

// The raw enums, so callers that build their own query object (library.remote.ts) validate
// against the same values the page form does instead of a bare z.string().
export const itemTypeEnum = typeEnum;
export const itemStateEnum = stateEnum;
export const itemSortEnum = sortEnum;

export const typeOptions = typeEnum.enum;
export const stateOptions = stateEnum.enum;
export const sortOptions = sortEnum.enum;
