<script lang="ts">
    import PortraitCard from "$lib/components/media/portrait-card.svelte";
    import { Badge } from "$lib/components/ui/badge/index.js";
    import { cn } from "$lib/utils";

    const badgeVariantClasses: Record<string, string> = {
        success: "bg-green-600/90 text-white border-0",
        error: "bg-red-600/90 text-white border-0",
        default: "bg-yellow-600/90 text-white border-0"
    };

    let {
        data = $bindable(),
        indexer = $bindable<string | undefined>(),
        type = $bindable<string | undefined>(),
        isSelectable = false,
        selectStore = undefined,
        class: className = ""
    } = $props();

    // Normalize type for different indexers
    let normalizedType = $derived.by(() => {
        let t = type;
        if (indexer === "anilist" && !t) t = data.media_type;
        if ((indexer === "tvdb" || indexer === "tmdb") && t === "show") t = "tv";
        // Seasons and episodes have no detail page of their own - the only page
        // that can render them is their SHOW's. Without this they fell through
        // to the generic /details/{indexer}/{type}/{id} branch and produced
        // /details/tvdb/episode/393189, which 404s twice over: `episode` is not
        // in the detailsMediaType route matcher, and 393189 is the SERIES tvdb
        // id (from parent_ids), not the episode's own (10983019).
        if (t === "season" || t === "episode") t = "tv";
        // Ensure type is set if only in data
        if (!t && data.media_type) t = data.media_type;
        return t;
    });

    let mediaURL = $derived.by(() => {
        if (!data.id) return null;
        if (normalizedType === "person" || normalizedType === "company") {
            return `/details/entity/${data.id}/${normalizedType}`;
        }

        // A season/episode card must link to its parent SHOW, keyed by the
        // parent's tvdb id. Riven stores shows as TVDB-only (0 of 1,024 shows
        // carry a tmdb_id), so `?indexer=tvdb` is required or the details
        // loader will try to resolve this number as a TMDB id and miss.
        if (type === "season" || type === "episode") {
            const parentTvdb = data.parent_ids?.tvdb_id;
            if (parentTvdb) return `/details/media/${parentTvdb}/tv?indexer=tvdb`;
        }

        if (
            (indexer === "tmdb" || indexer === "tvdb" || indexer === undefined) &&
            (normalizedType === "movie" || normalizedType === "tv")
        ) {
            // Include indexer as query param when it's tvdb so details page knows to skip resolution
            const queryParam = indexer === "tvdb" ? "?indexer=tvdb" : "";
            // If indexer is undefined, assume tmdb behavior for now as default
            return `/details/media/${data.id}/${normalizedType}${queryParam}`;
        }
        return `/details/${indexer}${normalizedType ? `/${normalizedType}` : ""}/${data.id}`;
    });

    let subtitle = $derived.by(() => {
        const parts = [];
        if (data.media_type === "tv" || normalizedType === "tv") parts.push("TV");
        else if (data.media_type === "movie" || normalizedType === "movie") parts.push("Movie");
        else if (data.media_type === "person" || normalizedType === "person") parts.push("Person");
        else if (data.media_type === "company" || normalizedType === "company")
            parts.push("Studio");

        if (data.year && data.year !== "N/A") parts.push(data.year);
        return parts.join(" • ") || null;
    });

    // Default container classes (w-full allows grid to control width)
    // Merged with passed className
    const containerClasses = $derived(
        cn(
            "group relative block w-full outline-none ring-offset-2 focus-visible:ring-2 focus-visible:ring-primary rounded-xl",
            className
        )
    );
</script>

{#snippet cardContent()}
    <PortraitCard
        title={data.title}
        {subtitle}
        image={data.poster_path}
        {isSelectable}
        isSelected={isSelectable && !!data.riven_id && selectStore?.has(data.riven_id!)}
        onSelectToggle={() => data.riven_id && selectStore?.toggle(data.riven_id!)}>
        {#snippet topRight()}
            {#if data.badge}
                <Badge
                    class={cn(
                        "border-white/10 px-2 py-0.5 text-[10px] shadow-sm backdrop-blur-md",
                        badgeVariantClasses[data.badge.variant] || badgeVariantClasses.default
                    )}>{data.badge.text}</Badge>
            {/if}
        {/snippet}
    </PortraitCard>
{/snippet}

{#if mediaURL}
    <!-- svelte-ignore svelte/no-navigation-without-resolve -->
    <a href={mediaURL} class={containerClasses}>
        {@render cardContent()}
    </a>
{:else}
    <div role="button" aria-disabled="true" tabindex="-1" class={containerClasses}>
        {@render cardContent()}
    </div>
{/if}
