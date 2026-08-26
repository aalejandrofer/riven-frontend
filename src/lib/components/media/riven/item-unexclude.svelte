<script lang="ts">
    import { toast } from "svelte-sonner";
    import { Button } from "$lib/components/ui/button/index.js";
    import Loader2 from "@lucide/svelte/icons/loader-2";
    import { invalidateAll } from "$app/navigation";
    import { type Snippet } from "svelte";
    import providers from "$lib/providers";

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
        variant = "secondary",
        size = "sm",
        children,
        ...restProps
    }: Props = $props();

    let loading = $state(false);

    async function unexcludeMediaItem() {
        console.log("[unexclude] start", { title, mediaType, tvdbId, tmdbId, imdbId, ids });
        loading = true;
        try {
            const getResp = await providers.riven.GET(
                "/api/v1/settings/get/{paths}",
                { params: { path: { paths: "filesystem.excluded_items" } } }
            );
            if (getResp.error) {
                toast.error("Failed to read settings.");
                return;
            }
            const raw =
                (getResp.data as Record<string, { shows?: unknown[]; movies?: unknown[]; infohashes?: unknown[]; infohash_labels?: Record<string, string> }>)
                    ?.["filesystem.excluded_items"] ?? {};
            const current = {
                shows: Array.isArray(raw.shows) ? raw.shows.map(String) : [],
                movies: Array.isArray(raw.movies) ? raw.movies.map(String) : [],
                infohashes: Array.isArray(raw.infohashes)
                    ? raw.infohashes.map(String)
                    : [],
                // Preserve infohash_labels (patch 0030) — whole-object set would wipe them.
                infohash_labels:
                    raw.infohash_labels && typeof raw.infohash_labels === "object"
                        ? raw.infohash_labels
                        : {}
            };

            const tvdb = tvdbId != null ? String(tvdbId) : null;
            const tmdb = tmdbId != null ? String(tmdbId) : null;
            const imdb = imdbId != null ? String(imdbId) : null;
            if (mediaType === "show") {
                current.shows = current.shows.filter(
                    (s) => s !== tvdb && s !== tmdb && s !== imdb
                );
            } else {
                current.movies = current.movies.filter(
                    (m) => m !== tmdb && m !== imdb
                );
            }

            const setResp = await providers.riven.POST(
                "/api/v1/settings/set/{paths}",
                {
                    params: { path: { paths: "filesystem.excluded_items" } },
                    body: { "filesystem.excluded_items": current } as never
                }
            );
            if (setResp.error) {
                toast.error("Failed to update settings.");
                return;
            }

            // /settings/load is implicit in /settings/set; don't call twice.

            const validIds = ids.filter(
                (id): id is string => id !== null && id !== undefined
            );
            if (validIds.length > 0) {
                await providers.riven.POST("/api/v1/items/retry", {
                    body: { ids: validIds }
                });
            }

            toast.success(`"${title}" removed from Blocklist. Riven will re-scrape on next pass.`);
            invalidateAll();
        } catch (e) {
            toast.error(`Remove from Blocklist failed: ${e instanceof Error ? e.message : e}`);
        } finally {
            loading = false;
        }
    }
</script>

<Button
    {variant}
    {size}
    aria-label={`Remove ${title ?? "media item"} from Blocklist`}
    {...restProps}
    disabled={loading}
    onclick={unexcludeMediaItem}>
    {#if loading}
        <Loader2 class="mr-1 inline-block animate-spin" />
    {/if}
    {#if children}
        {@render children()}
    {:else}
        Remove from Blocklist
    {/if}
</Button>
