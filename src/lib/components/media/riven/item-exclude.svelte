<script lang="ts">
    import { toast } from "svelte-sonner";
    import * as AlertDialog from "$lib/components/ui/alert-dialog/index.js";
    import { Button } from "$lib/components/ui/button/index.js";
    import Loader2 from "@lucide/svelte/icons/loader-2";
    import { invalidateAll, goto } from "$app/navigation";
    import { createScopedLogger } from "$lib/logger";
    import providers from "$lib/providers";

    const logger = createScopedLogger("item-exclude");

    import { type Snippet } from "svelte";

    interface Props {
        title: string | null | undefined;
        mediaType: "movie" | "show";
        tvdbId?: string | number | null;
        tmdbId?: string | number | null;
        imdbId?: string | null;
        ids: (string | null | undefined)[];
        variant?:
            | "ghost"
            | "default"
            | "link"
            | "destructive"
            | "outline"
            | "secondary"
            | undefined;
        size?: "default" | "sm" | "lg" | "icon" | "icon-sm" | "icon-lg" | undefined;
        class?: string;
        children?: Snippet;
    }
    let {
        title,
        mediaType,
        tvdbId,
        tmdbId,
        imdbId,
        ids,
        variant = "destructive",
        size = "sm",
        children,
        ...restProps
    }: Props = $props();

    let loading = $state(false);
    let open = $state(false);

    async function excludeMediaItem() {
        console.log("[exclude] start", { title, mediaType, tvdbId, tmdbId, imdbId, ids });
        loading = true;
        try {
            console.log("[exclude] GET /settings/get/filesystem.excluded_items");
            const getResp = await providers.riven.GET(
                "/api/v1/settings/get/{paths}",
                { params: { path: { paths: "filesystem.excluded_items" } } }
            );
            if (getResp.error) {
                logger.error("GET excluded_items failed:", getResp.error);
                toast.error("Failed to read settings.");
                return;
            }
            // openapi-typescript can't infer the dotted-key value shape, so
            // fall back to a loose cast for this one access.
            const raw =
                (getResp.data as Record<string, { shows?: unknown[]; movies?: unknown[]; infohashes?: unknown[]; infohash_labels?: Record<string, string> }>)
                    ?.["filesystem.excluded_items"] ?? {};
            const current = {
                shows: Array.isArray(raw.shows) ? raw.shows.map(String) : [],
                movies: Array.isArray(raw.movies) ? raw.movies.map(String) : [],
                infohashes: Array.isArray(raw.infohashes)
                    ? raw.infohashes.map(String)
                    : [],
                // Preserve infohash_labels (patch 0030) — this POST replaces the
                // whole excluded_items object, so omitting it wipes every hash label.
                infohash_labels:
                    raw.infohash_labels && typeof raw.infohash_labels === "object"
                        ? raw.infohash_labels
                        : {}
            };

            if (mediaType === "show") {
                const id =
                    tvdbId != null
                        ? String(tvdbId)
                        : tmdbId != null
                          ? String(tmdbId)
                          : imdbId != null
                            ? String(imdbId)
                            : null;
                if (!id) {
                    toast.error("Show has no tvdb/tmdb/imdb id; cannot exclude.");
                    return;
                }
                if (!current.shows.includes(id)) current.shows.push(id);
            } else {
                const id =
                    tmdbId != null
                        ? String(tmdbId)
                        : imdbId != null
                          ? String(imdbId)
                          : null;
                if (!id) {
                    toast.error("Movie has no tmdb_id/imdb_id; cannot exclude.");
                    return;
                }
                if (!current.movies.includes(id)) current.movies.push(id);
            }

            console.log("[exclude] POST settings/set", current);
            const setResp = await providers.riven.POST(
                "/api/v1/settings/set/{paths}",
                {
                    params: { path: { paths: "filesystem.excluded_items" } },
                    body: { "filesystem.excluded_items": current } as never
                }
            );
            if (setResp.error) {
                logger.error("POST settings/set failed:", setResp.error);
                toast.error("Failed to add to user-exclusion-list.");
                return;
            }

            // /settings/load is a no-op here — settings_manager.load
            // already runs as part of set_settings (and re-inits every
            // service → ~60s). Don't call it again.

            // Trigger retry so backend's runner sees is_excluded → marks
            // last_state=Excluded (per patch 0012). Don't DELETE — 0012
            // keeps the row in DB so the UI can show it as Excluded.
            const validIds = ids.filter(
                (id): id is string => id !== null && id !== undefined
            );
            if (validIds.length > 0) {
                console.log("[exclude] retry ids", validIds);
                const retryResp = await providers.riven.POST(
                    "/api/v1/items/retry",
                    { body: { ids: validIds } }
                );
                if (retryResp.error) {
                    logger.warn("retry call failed:", retryResp.error);
                }
            }

            toast.success(
                `"${title}" added to Blocklist — Riven won't re-grab. Undo via the Blocklist.`
            );

            invalidateAll();
        } catch (e) {
            logger.error("exclude exception:", e);
            toast.error(`Blocklist failed: ${e instanceof Error ? e.message : e}`);
        } finally {
            loading = false;
        }
    }
</script>

<AlertDialog.Root bind:open>
    <AlertDialog.Trigger>
        {#snippet child({ props })}
            <Button
                {variant}
                {size}
                aria-label={`Add ${title ?? "media item"} to Blocklist`}
                {...restProps}
                {...props}
                disabled={loading}>
                {#if children}
                    {@render children()}
                {:else}
                    Blocklist
                {/if}
            </Button>
        {/snippet}
    </AlertDialog.Trigger>
    <AlertDialog.Content class="border border-white/10 bg-zinc-950/95 backdrop-blur-2xl">
        <AlertDialog.Header>
            <AlertDialog.Title>
                Add "{title ?? "Media Item"}" to Blocklist
            </AlertDialog.Title>
            <AlertDialog.Description>
                Blocklists this title so Riven will not add it again, even if a content
                source lists it.
            </AlertDialog.Description>
        </AlertDialog.Header>
        <AlertDialog.Footer>
            <AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
            <AlertDialog.Action
                onclick={() => {
                    open = false;
                    // Fire-and-forget: settings reload takes ~60s.
                    // Toasts inside excludeMediaItem notify completion.
                    excludeMediaItem();
                }}>
                Blocklist
            </AlertDialog.Action>
        </AlertDialog.Footer>
    </AlertDialog.Content>
</AlertDialog.Root>
