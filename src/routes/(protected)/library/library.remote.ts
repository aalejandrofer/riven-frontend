import { command, getRequestEvent } from "$app/server";
import { z } from "zod";
import providers from "$lib/providers";
import { itemStateEnum, itemTypeEnum } from "$lib/schemas/items";
import type { ItemsQuery, ItemsQueryWithExcluded } from "$lib/schemas/items";
import { describeApiError } from "$lib/utils/api-error";
import type { operations } from "$lib/providers/riven";

/**
 * Response shape for `GET /api/v1/items`, composed from the generated Riven client so the
 * spec stays the source of truth instead of a hand-written shape. The query shapes live in
 * `$lib/schemas/items` next to the enums that validate them.
 */
type ItemsResponseBody = operations["get_items"]["responses"][200]["content"]["application/json"];

const itemIdsSchema = z.object({
    ids: z.array(z.string())
});

const allMatchingSchema = z.object({
    search: z.string().optional(),
    type: z.array(itemTypeEnum).optional(),
    states: z.array(itemStateEnum).optional()
});

const MAX_SELECT_ALL = 5000;
const PAGE_SIZE = 500;

/**
 * `ItemsResponse.items` is `{ [key: string]: unknown }[]` in the spec, so the id has to be
 * narrowed here rather than asserted. Riven serialises it as a STRING (`"59695"`), and the
 * whole library selection chain carries strings at runtime — coercing to a number here would
 * make these ids unequal to the ones the page loader puts in the same `ItemStore`, and
 * select-all would silently stop matching the rendered cards.
 */
function readItemIds(items: ItemsResponseBody["items"]): string[] {
    const out: string[] = [];
    for (const row of items) {
        const id: unknown = row.id;
        if (typeof id === "string") out.push(id);
        else if (typeof id === "number") out.push(String(id));
    }
    return out;
}

export const fetch_all_matching_ids = command(allMatchingSchema, async ({ search, type, states }) => {
    const event = getRequestEvent();
    if (!event) throw new Error("No event found");

    const { backendUrl, apiKey } = event.locals;
    if (!backendUrl || !apiKey) {
        throw new Error("Backend URL or API key missing");
    }

    const ids: string[] = [];
    let page = 1;

    while (ids.length < MAX_SELECT_ALL) {
        const query: ItemsQueryWithExcluded = {
            search,
            type,
            states,
            page,
            limit: PAGE_SIZE
        };

        const res = await providers.riven.GET("/api/v1/items", {
            params: {
                // See ItemsQueryWithExcluded: the only unmodelled value is `Excluded`.
                query: query as ItemsQuery
            },
            baseUrl: backendUrl,
            headers: { "x-api-key": apiKey }
        });
        if (res.error) {
            throw new Error(describeApiError(res.error, "Riven request failed"));
        }
        const items = res.data?.items ?? [];
        if (items.length === 0) break;
        for (const id of readItemIds(items)) ids.push(id);
        const totalPages = res.data?.total_pages ?? 1;
        if (page >= totalPages) break;
        page += 1;
    }

    return { ids, capped: ids.length >= MAX_SELECT_ALL };
});

export const reset_items = command(itemIdsSchema, async ({ ids }) => {
    const event = getRequestEvent();
    if (!event) throw new Error("No event found");

    // We need to access locals for auth
    const { backendUrl, apiKey } = event.locals;

    if (!backendUrl || !apiKey) {
        throw new Error("Backend URL or API key missing");
    }

    const res = await providers.riven.POST("/api/v1/items/reset", {
        body: { ids },
        baseUrl: backendUrl,
        headers: {
            "x-api-key": apiKey
        }
    });

    if (res.error) {
        throw new Error(describeApiError(res.error, "Riven request failed"));
    }

    return { success: true, count: ids.length };
});

export const retry_items = command(itemIdsSchema, async ({ ids }) => {
    const event = getRequestEvent();
    if (!event) throw new Error("No event found");

    const { backendUrl, apiKey } = event.locals;

    if (!backendUrl || !apiKey) {
        throw new Error("Backend URL or API key missing");
    }

    const res = await providers.riven.POST("/api/v1/items/retry", {
        body: { ids },
        baseUrl: backendUrl,
        headers: {
            "x-api-key": apiKey
        }
    });

    if (res.error) {
        throw new Error(describeApiError(res.error, "Riven request failed"));
    }

    return { success: true, count: ids.length };
});

export const remove_items = command(itemIdsSchema, async ({ ids }) => {
    const event = getRequestEvent();
    if (!event) throw new Error("No event found");

    const { backendUrl, apiKey } = event.locals;

    if (!backendUrl || !apiKey) {
        throw new Error("Backend URL or API key missing");
    }

    const res = await providers.riven.DELETE("/api/v1/items/remove", {
        body: { ids },
        baseUrl: backendUrl,
        headers: {
            "x-api-key": apiKey
        }
    });

    if (res.error) {
        throw new Error(describeApiError(res.error, "Riven request failed"));
    }

    return { success: true, count: ids.length };
});
