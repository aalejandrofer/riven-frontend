<script lang="ts">
    import type { PageData } from "./$types";
    import PageShell from "$lib/components/page-shell.svelte";
    import ItemUnexclude from "$lib/components/media/riven/item-unexclude.svelte";
    import { Button } from "$lib/components/ui/button/index.js";
    import { Badge } from "$lib/components/ui/badge/index.js";
    import { Checkbox } from "$lib/components/ui/checkbox/index.js";
    import * as Select from "$lib/components/ui/select/index.js";
    import * as AlertDialog from "$lib/components/ui/alert-dialog/index.js";
    import { toast } from "svelte-sonner";
    import { invalidateAll, replaceState } from "$app/navigation";
    import { page as appPage } from "$app/state";
    import { Input } from "$lib/components/ui/input/index.js";
    import Trash2 from "@lucide/svelte/icons/trash-2";
    import ChevronRight from "@lucide/svelte/icons/chevron-right";
    import SearchIcon from "@lucide/svelte/icons/search";
    import Loader2 from "@lucide/svelte/icons/loader-2";

    let { data }: { data: PageData } = $props();

    // --- per-item stream blacklist (patch 0038) --------------------------------
    // Typed off PageData (which the loader's return type feeds) rather than
    // importing from +page.server.ts — that module is server-only.
    type PerItemPage = NonNullable<PageData["perItem"]>;
    type PerItemGroup = PerItemPage["items"][number];

    /**
     * The section owns its own data after hydration. The loader still renders the
     * first page (SSR, shareable URL), but paging / searching / resizing goes
     * straight to the backend through the authenticated proxy at
     * (protected)/api/[...backendProxy] and only the URL is rewritten, with
     * `replaceState`. Re-running the page loader for that cost ~530ms of which
     * ~400ms was re-resolving the GLOBAL sections' titles — a Riven lookup plus a
     * TVDB round trip that cannot change when only this section's page moves.
     */
    // svelte-ignore state_referenced_locally
    let perItem = $state<PerItemPage | null>(data.perItem);
    // svelte-ignore state_referenced_locally
    let perItemPageNo = $state(data.perItemPage);
    // svelte-ignore state_referenced_locally
    let perItemQuery = $state(data.perItemQuery);
    // svelte-ignore state_referenced_locally
    let perItemShow451 = $state(data.perItemShow451);
    // svelte-ignore state_referenced_locally
    let perItemPageSize = $state(data.perItemPageSize);
    let perItemLoading = $state(false);
    let perItemFetchError = $state<string | null>(null);

    let expanded = $state<Record<number, boolean>>({});
    let removing = $state<string | null>(null);
    let bulkRunning = $state(false);

    const perItemTotalPages = $derived(Math.max(perItem?.total_pages ?? 1, 1));

    function toggle(itemId: number) {
        expanded[itemId] = !expanded[itemId];
    }

    // --- selection ------------------------------------------------------------
    // Keyed `itemId:streamId` so a stream blacklisted for two different items is
    // two independent selections. Cleared whenever the visible page changes: bulk
    // remove must only ever act on rows the user can actually see.
    type SelectedStream = { itemId: number; streamId: number; label: string };
    let selectedStreams = $state<Record<string, SelectedStream>>({});
    const selectedStreamCount = $derived(Object.keys(selectedStreams).length);

    const pageStreamKeys = $derived(
        (perItem?.items ?? []).flatMap((group) =>
            group.streams.map((stream) => `${group.item_id}:${stream.stream_id}`)
        )
    );
    const allPageStreamsSelected = $derived(
        pageStreamKeys.length > 0 && pageStreamKeys.every((key) => key in selectedStreams)
    );

    function streamKey(itemId: number, streamId: number) {
        return `${itemId}:${streamId}`;
    }

    function toggleStream(group: PerItemGroup, streamId: number, on: boolean) {
        const key = streamKey(group.item_id, streamId);
        if (on) selectedStreams[key] = { itemId: group.item_id, streamId, label: group.title };
        else delete selectedStreams[key];
    }

    function groupSelectedCount(group: PerItemGroup) {
        return group.streams.filter((s) => streamKey(group.item_id, s.stream_id) in selectedStreams)
            .length;
    }

    function toggleGroup(group: PerItemGroup, on: boolean) {
        for (const stream of group.streams) toggleStream(group, stream.stream_id, on);
    }

    function toggleSelectPage() {
        if (allPageStreamsSelected) {
            selectedStreams = {};
            return;
        }
        for (const group of perItem?.items ?? []) toggleGroup(group, true);
    }

    // --- data loading ---------------------------------------------------------
    /**
     * Fetch one page of the per-item section and (optionally) rewrite the URL to
     * match. `replaceState` is shallow routing: the address bar stays shareable
     * and a reload reproduces the view through the loader, but no `load` re-runs,
     * so the global sections above are untouched.
     */
    async function loadPerItem(
        next: { page?: number; query?: string; show451?: boolean; size?: number } = {},
        opts: { updateUrl?: boolean } = {}
    ) {
        const nextPage = next.page ?? perItemPageNo;
        const nextQuery = next.query ?? perItemQuery;
        const next451 = next.show451 ?? perItemShow451;
        const nextSize = next.size ?? perItemPageSize;

        const params = new URLSearchParams({
            page: String(Math.max(1, nextPage)),
            limit: String(nextSize)
        });
        if (nextQuery) params.set("search", nextQuery);
        if (next451) params.set("include_451", "true");

        perItemLoading = true;
        perItemFetchError = null;
        try {
            const resp = await fetch(`/api/v1/items/blacklisted_streams?${params}`);
            if (!resp.ok) {
                perItemFetchError = `HTTP ${resp.status}`;
                toast.error(`Failed to load blacklisted releases (HTTP ${resp.status}).`);
                return;
            }
            const loaded = (await resp.json()) as PerItemPage;

            perItem = loaded;
            perItemPageNo = loaded.page;
            perItemQuery = nextQuery;
            perItemShow451 = next451;
            perItemPageSize = nextSize;
            expanded = {};
            selectedStreams = {};

            if (opts.updateUrl !== false) {
                const url = new URL(appPage.url);
                if (loaded.page > 1) url.searchParams.set("blPage", String(loaded.page));
                else url.searchParams.delete("blPage");
                if (nextQuery) url.searchParams.set("blQ", nextQuery);
                else url.searchParams.delete("blQ");
                if (next451) url.searchParams.set("bl451", "1");
                else url.searchParams.delete("bl451");
                if (nextSize !== data.perItemDefaultPageSize)
                    url.searchParams.set("blSize", String(nextSize));
                else url.searchParams.delete("blSize");
                replaceState(url, appPage.state);
            }

            // Removing the last rows of the last page can leave the requested page
            // past the end. Land on the new last page instead of an empty view.
            if (loaded.items.length === 0 && loaded.total_pages > 0 && nextPage > loaded.total_pages) {
                await loadPerItem({ page: loaded.total_pages }, opts);
            }
        } catch (e) {
            perItemFetchError = e instanceof Error ? e.message : String(e);
            toast.error(perItemFetchError);
        } finally {
            perItemLoading = false;
        }
    }

    async function onPerItemSearch(event: SubmitEvent) {
        event.preventDefault();
        const form = event.currentTarget as HTMLFormElement;
        const query = String(new FormData(form).get("blQ") ?? "").trim();
        await loadPerItem({ page: 1, query });
    }

    // --- removal --------------------------------------------------------------
    /**
     * Removal reuses Riven's stock endpoint. It deletes the
     * StreamBlacklistRelation row AND puts the release back into `item.streams`,
     * so the item's state is recomputed — that is the intent of un-blacklisting.
     */
    async function unblacklistOne(itemId: number, streamId: number): Promise<boolean> {
        const resp = await fetch(`/api/v1/items/${itemId}/streams/${streamId}/unblacklist`, {
            method: "POST"
        });
        return resp.ok;
    }

    async function unblacklistStream(itemId: number, streamId: number, label: string) {
        const key = streamKey(itemId, streamId);
        removing = key;
        try {
            if (!(await unblacklistOne(itemId, streamId))) {
                toast.error(`Failed to un-blacklist ${label}.`);
                return;
            }
            toast.success(`Un-blacklisted ${label}`);
            delete selectedStreams[key];
            // Refresh only this section — the global sections cannot have changed,
            // and re-running the whole loader for one row is what made this page
            // feel slow.
            await loadPerItem({}, { updateUrl: false });
        } catch (e) {
            toast.error(e instanceof Error ? e.message : String(e));
        } finally {
            removing = null;
        }
    }

    /**
     * Bulk remove. There is no batch endpoint and deliberately no new one: the
     * stock per-stream POST is the only write path. Requests run a few at a time
     * — sequential is needlessly slow at 100 rows, unbounded parallelism hammers
     * the backend — and every failure is counted rather than aborting the run.
     */
    async function bulkUnblacklist() {
        const targets = Object.values(selectedStreams);
        if (targets.length === 0) return;
        bulkRunning = true;
        let ok = 0;
        let failed = 0;
        try {
            const CONCURRENCY = 4;
            let cursor = 0;
            const worker = async () => {
                while (cursor < targets.length) {
                    const target = targets[cursor++];
                    try {
                        if (await unblacklistOne(target.itemId, target.streamId)) ok++;
                        else failed++;
                    } catch {
                        failed++;
                    }
                }
            };
            await Promise.all(
                Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker)
            );

            if (failed === 0) toast.success(`Un-blacklisted ${ok} release${ok === 1 ? "" : "s"}`);
            else if (ok === 0) toast.error(`Failed to un-blacklist ${failed} release(s).`);
            else toast.warning(`Un-blacklisted ${ok}; ${failed} failed.`);

            selectedStreams = {};
            await loadPerItem({}, { updateUrl: false });
        } finally {
            bulkRunning = false;
        }
    }

    /**
     * Detail-page link. Riven keys shows by tvdb and movies by tmdb (no show in
     * this DB carries a tmdb id), but /details/media/[id]/tv expects a TMDB id
     * unless told otherwise — hence `?indexer=tvdb`, same as /calendar. Do not
     * link TV through /details/tvdb/tv/{id}: that endpoint redirects without the
     * hint, so the page then tries to resolve the tvdb id as a tmdb one.
     */
    function detailHref(group: PerItemGroup): string | null {
        if (group.root_type === "movie" && group.tmdb_id) {
            return `/details/media/${group.tmdb_id}/movie`;
        }
        if (group.root_type === "show" && group.tvdb_id) {
            return `/details/media/${group.tvdb_id}/tv?indexer=tvdb`;
        }
        return null;
    }

    // --- global infohash blocklist -------------------------------------------
    let selectedHashes = $state<Record<string, true>>({});
    let hashBulkRunning = $state(false);
    const selectedHashCount = $derived(Object.keys(selectedHashes).length);
    const allHashesSelected = $derived(
        data.infohashes.length > 0 && data.infohashes.every(({ hash }) => hash in selectedHashes)
    );

    function toggleHash(hash: string, on: boolean) {
        if (on) selectedHashes[hash] = true;
        else delete selectedHashes[hash];
    }

    function toggleSelectAllHashes() {
        if (allHashesSelected) {
            selectedHashes = {};
            return;
        }
        for (const { hash } of data.infohashes) selectedHashes[hash] = true;
    }

    /**
     * Remove one or many infohashes in a SINGLE settings write. Every `set` of
     * excluded_items replaces the whole object, so `infohash_labels` must be
     * carried forward minus the removed keys or all labels are wiped (this has
     * bitten twice — see CLAUDE.md). One write for N hashes also means N-1 fewer
     * chances to lose them.
     */
    async function removeInfohashes(hashes: string[]) {
        if (hashes.length === 0) return;
        const doomed = new Set(hashes);
        const getResp = await fetch("/api/v1/settings/get/filesystem.excluded_items");
        if (!getResp.ok) {
            toast.error(`Failed to read settings (HTTP ${getResp.status}).`);
            return;
        }
        const getJson = await getResp.json();
        const raw = getJson?.["filesystem.excluded_items"] ?? {};
        const labels: Record<string, string> = { ...(raw.infohash_labels ?? {}) };
        for (const hash of doomed) delete labels[hash];
        const current = {
            shows: Array.isArray(raw.shows) ? raw.shows.map(String) : [],
            movies: Array.isArray(raw.movies) ? raw.movies.map(String) : [],
            infohashes: (Array.isArray(raw.infohashes) ? raw.infohashes.map(String) : []).filter(
                (h: string) => !doomed.has(h)
            ),
            infohash_labels: labels
        };
        const setResp = await fetch("/api/v1/settings/set/filesystem.excluded_items", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ "filesystem.excluded_items": current })
        });
        if (!setResp.ok) {
            toast.error(`Failed to update settings (HTTP ${setResp.status}).`);
            return;
        }
        for (const hash of doomed) delete selectedHashes[hash];
        toast.success(
            hashes.length === 1
                ? `Removed infohash ${hashes[0].slice(0, 12)}…`
                : `Removed ${hashes.length} infohashes`
        );
        await invalidateAll();
    }

    async function bulkRemoveInfohashes() {
        hashBulkRunning = true;
        try {
            await removeInfohashes(Object.keys(selectedHashes));
        } finally {
            hashBulkRunning = false;
        }
    }
</script>

<svelte:head>
    <title>Blocklist - Riven</title>
</svelte:head>

<PageShell class="h-full">
    <div class="mx-auto flex w-full max-w-5xl flex-col gap-10 px-6 py-10">
        <header class="flex flex-col gap-2">
            <h1 class="font-heading text-3xl font-bold tracking-tight">Blocklist</h1>
            <p class="text-muted-foreground text-sm">
                Items here are blocked from being re-grabbed by Riven. Use this page to review and
                remove entries.
            </p>
        </header>

        <section class="flex flex-col gap-4">
            <h2 class="font-heading text-xl font-semibold">
                Shows
                <Badge variant="outline" class="ml-2 font-mono text-xs">{data.shows.length}</Badge>
            </h2>
            {#if data.shows.length === 0}
                <p class="text-muted-foreground text-sm">No blocklisted shows.</p>
            {:else}
                <div
                    class="flex flex-col divide-y divide-white/[0.04] overflow-hidden rounded-xl border border-white/5">
                    {#each data.shows as show (show.externalId)}
                        <div class="flex items-center gap-3 px-3 py-2">
                            {#if show.posterPath}
                                <img
                                    src={show.posterPath}
                                    alt=""
                                    class="h-11 w-8 rounded object-cover"
                                    loading="lazy" />
                            {:else}
                                <div class="bg-muted h-11 w-8 rounded" aria-hidden="true"></div>
                            {/if}
                            <div class="min-w-0 flex-1">
                                <p class="truncate font-medium">
                                    {show.title ?? `Show ${show.externalId}`}
                                </p>
                                <p class="text-muted-foreground font-mono text-xs">
                                    tvdb {show.externalId}
                                </p>
                            </div>
                            <ItemUnexclude
                                title={show.title ?? `Show ${show.externalId}`}
                                mediaType="show"
                                tvdbId={show.externalId}
                                ids={show.rivenId ? [show.rivenId] : []}
                                size="sm"
                                variant="secondary"
                                class="border-primary/40 text-primary hover:bg-primary/10 hover:border-primary border bg-transparent">
                                Remove
                            </ItemUnexclude>
                        </div>
                    {/each}
                </div>
            {/if}
        </section>

        <section class="flex flex-col gap-4">
            <h2 class="font-heading text-xl font-semibold">
                Movies
                <Badge variant="outline" class="ml-2 font-mono text-xs">{data.movies.length}</Badge>
            </h2>
            {#if data.movies.length === 0}
                <p class="text-muted-foreground text-sm">No blocklisted movies.</p>
            {:else}
                <div
                    class="flex flex-col divide-y divide-white/[0.04] overflow-hidden rounded-xl border border-white/5">
                    {#each data.movies as movie (movie.externalId)}
                        <div class="flex items-center gap-3 px-3 py-2">
                            {#if movie.posterPath}
                                <img
                                    src={movie.posterPath}
                                    alt=""
                                    class="h-11 w-8 rounded object-cover"
                                    loading="lazy" />
                            {:else}
                                <div class="bg-muted h-11 w-8 rounded" aria-hidden="true"></div>
                            {/if}
                            <div class="min-w-0 flex-1">
                                <p class="truncate font-medium">
                                    {movie.title ?? `Movie ${movie.externalId}`}
                                </p>
                                <p class="text-muted-foreground font-mono text-xs">
                                    tmdb {movie.externalId}
                                </p>
                            </div>
                            <ItemUnexclude
                                title={movie.title ?? `Movie ${movie.externalId}`}
                                mediaType="movie"
                                tmdbId={movie.externalId}
                                ids={movie.rivenId ? [movie.rivenId] : []}
                                size="sm"
                                variant="secondary"
                                class="border-primary/40 text-primary hover:bg-primary/10 hover:border-primary border bg-transparent">
                                Remove
                            </ItemUnexclude>
                        </div>
                    {/each}
                </div>
            {/if}
        </section>

        <section class="flex flex-col gap-4">
            <h2 class="font-heading text-xl font-semibold">
                Infohashes
                <Badge variant="outline" class="ml-2 font-mono text-xs"
                    >{data.infohashes.length}</Badge>
            </h2>
            {#if data.infohashes.length === 0}
                <p class="text-muted-foreground text-sm">No blocklisted infohashes.</p>
            {:else}
                <div class="flex flex-wrap items-center gap-2">
                    <div class="flex items-center gap-2">
                        <Checkbox
                            id="select-all-hashes"
                            checked={allHashesSelected}
                            indeterminate={selectedHashCount > 0 && !allHashesSelected}
                            aria-label="Select all blocklisted infohashes"
                            onCheckedChange={toggleSelectAllHashes} />
                        <label for="select-all-hashes" class="text-muted-foreground text-xs">
                            Select all ({data.infohashes.length})
                        </label>
                    </div>
                    {#if selectedHashCount > 0}
                        <AlertDialog.Root>
                            <AlertDialog.Trigger>
                                {#snippet child({ props })}
                                    <Button
                                        {...props}
                                        size="sm"
                                        variant="secondary"
                                        disabled={hashBulkRunning}
                                        class="border-destructive/40 text-destructive hover:bg-destructive/10 border bg-transparent">
                                        {#if hashBulkRunning}
                                            <Loader2 class="mr-1 h-3.5 w-3.5 animate-spin" />
                                        {/if}
                                        Remove {selectedHashCount} selected
                                    </Button>
                                {/snippet}
                            </AlertDialog.Trigger>
                            <AlertDialog.Content
                                class="border border-white/10 bg-zinc-950/95 backdrop-blur-2xl">
                                <AlertDialog.Header>
                                    <AlertDialog.Title>
                                        Remove {selectedHashCount} infohash{selectedHashCount === 1
                                            ? ""
                                            : "es"} from the blocklist?
                                    </AlertDialog.Title>
                                    <AlertDialog.Description>
                                        These releases become eligible again for every item. Applied
                                        as one settings write.
                                    </AlertDialog.Description>
                                </AlertDialog.Header>
                                <AlertDialog.Footer>
                                    <AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
                                    <AlertDialog.Action
                                        disabled={hashBulkRunning}
                                        onclick={bulkRemoveInfohashes}>
                                        Remove {selectedHashCount}
                                    </AlertDialog.Action>
                                </AlertDialog.Footer>
                            </AlertDialog.Content>
                        </AlertDialog.Root>
                        <Button
                            size="sm"
                            variant="ghost"
                            onclick={() => (selectedHashes = {})}>
                            Clear selection
                        </Button>
                    {/if}
                </div>
                <div class="flex flex-col divide-y divide-white/10">
                    {#each data.infohashes as { hash, label } (hash)}
                        <div class="flex items-center gap-3 py-1">
                            <Checkbox
                                checked={hash in selectedHashes}
                                aria-label={`Select infohash ${hash}`}
                                onCheckedChange={(checked: boolean) => toggleHash(hash, !!checked)} />
                            <div class="flex min-w-0 flex-1 items-baseline gap-2">
                                {#if label}
                                    <span class="shrink-0 text-sm font-medium">{label}</span>
                                {/if}
                                <span class="text-muted-foreground truncate font-mono text-xs">
                                    {hash}
                                </span>
                            </div>
                            <Button
                                size="icon-sm"
                                variant="ghost"
                                aria-label={`Remove infohash ${hash}`}
                                title="Remove from blocklist"
                                class="text-destructive hover:bg-destructive/10 h-6 w-6 shrink-0"
                                onclick={() => removeInfohashes([hash])}>
                                <Trash2 class="h-3.5 w-3.5" />
                            </Button>
                        </div>
                    {/each}
                </div>
            {/if}
        </section>

        <section class="flex flex-col gap-4">
            <div class="flex flex-col gap-1">
                <h2 class="font-heading text-xl font-semibold">
                    Per-Item Blacklisted Releases
                    {#if perItem}
                        <Badge variant="outline" class="ml-2 font-mono text-xs">
                            {perItem.total_items}
                        </Badge>
                    {/if}
                </h2>
                <p class="text-muted-foreground text-sm">
                    <strong>Almost all of these are created automatically, not by you.</strong> Riven bans a
                    release for a single item whenever a debrid service refuses its hash — Real-Debrid's 451
                    responses account for the bulk of them — and resetting an item bans whatever release it
                    was on. Nothing here is a decision you made unless you made it deliberately.
                </p>
                <p class="text-muted-foreground text-sm">
                    These are <em>per-item</em> bans and are unrelated to the global infohash list above:
                    the same release stays available to every other item. Removing one lets Riven consider
                    that release again for that item. 451-flagged rows are hidden by default because the
                    451 check skips them anyway, so un-banning one just gets it re-banned.
                </p>
            </div>

            {#if data.perItemError === "unsupported"}
                <p class="text-muted-foreground text-sm">
                    Not available on this backend — requires Riven patch
                    <span class="font-mono">0038</span> (<span class="font-mono"
                        >GET /api/v1/items/blacklisted_streams</span
                    >).
                </p>
            {:else if data.perItemError && !perItem}
                <p class="text-destructive text-sm">
                    Failed to load per-item blacklist: {data.perItemError}
                </p>
            {:else if perItem}
                <div class="flex flex-wrap items-center gap-3">
                    <form class="flex min-w-0 flex-1 items-center gap-2" onsubmit={onPerItemSearch}>
                        <div class="relative min-w-0 flex-1">
                            <SearchIcon
                                class="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2" />
                            <Input
                                type="search"
                                name="blQ"
                                value={perItemQuery}
                                placeholder="Search by title…"
                                aria-label="Search per-item blacklisted releases by title"
                                class="pl-8" />
                        </div>
                        <Button type="submit" size="sm" variant="secondary" disabled={perItemLoading}>
                            Search
                        </Button>
                        {#if perItemQuery}
                            <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                disabled={perItemLoading}
                                onclick={() => loadPerItem({ page: 1, query: "" })}>
                                Clear
                            </Button>
                        {/if}
                    </form>

                    <Button
                        size="sm"
                        variant={perItemShow451 ? "secondary" : "ghost"}
                        aria-pressed={perItemShow451}
                        disabled={perItemLoading}
                        title="451-flagged releases are already skipped by the 451 gate, so they are hidden by default"
                        onclick={() => loadPerItem({ page: 1, show451: !perItemShow451 })}>
                        {perItemShow451 ? "Hiding" : "Show"} 451-flagged ({perItem.hidden_451})
                    </Button>
                </div>

                <div class="flex flex-wrap items-center gap-3">
                    <div class="flex items-center gap-2">
                        <Checkbox
                            id="select-page-streams"
                            checked={allPageStreamsSelected}
                            indeterminate={selectedStreamCount > 0 && !allPageStreamsSelected}
                            disabled={pageStreamKeys.length === 0}
                            aria-label="Select every release on this page"
                            onCheckedChange={toggleSelectPage} />
                        <label for="select-page-streams" class="text-muted-foreground text-xs">
                            Select page ({pageStreamKeys.length} release{pageStreamKeys.length === 1
                                ? ""
                                : "s"})
                        </label>
                    </div>

                    {#if selectedStreamCount > 0}
                        <AlertDialog.Root>
                            <AlertDialog.Trigger>
                                {#snippet child({ props })}
                                    <Button
                                        {...props}
                                        size="sm"
                                        variant="secondary"
                                        disabled={bulkRunning}
                                        class="border-destructive/40 text-destructive hover:bg-destructive/10 border bg-transparent">
                                        {#if bulkRunning}
                                            <Loader2 class="mr-1 h-3.5 w-3.5 animate-spin" />
                                        {/if}
                                        Remove {selectedStreamCount} selected
                                    </Button>
                                {/snippet}
                            </AlertDialog.Trigger>
                            <AlertDialog.Content
                                class="border border-white/10 bg-zinc-950/95 backdrop-blur-2xl">
                                <AlertDialog.Header>
                                    <AlertDialog.Title>
                                        Un-blacklist {selectedStreamCount} release{selectedStreamCount ===
                                        1
                                            ? ""
                                            : "s"}?
                                    </AlertDialog.Title>
                                    <AlertDialog.Description>
                                        Each release goes back into its item's stream list, so those
                                        items are re-evaluated and may be re-grabbed. A 451-flagged
                                        release will simply be blacklisted again on the next attempt.
                                    </AlertDialog.Description>
                                </AlertDialog.Header>
                                <AlertDialog.Footer>
                                    <AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
                                    <AlertDialog.Action
                                        disabled={bulkRunning}
                                        onclick={bulkUnblacklist}>
                                        Remove {selectedStreamCount}
                                    </AlertDialog.Action>
                                </AlertDialog.Footer>
                            </AlertDialog.Content>
                        </AlertDialog.Root>
                        <Button
                            size="sm"
                            variant="ghost"
                            onclick={() => (selectedStreams = {})}>
                            Clear selection
                        </Button>
                    {/if}

                    <div class="ml-auto flex items-center gap-2">
                        <span class="text-muted-foreground text-xs">Per page</span>
                        <Select.Root
                            type="single"
                            value={String(perItemPageSize)}
                            onValueChange={(v) => {
                                if (v) loadPerItem({ page: 1, size: Number(v) });
                            }}>
                            <Select.Trigger
                                class="h-8 w-[4.5rem] text-xs"
                                aria-label="Releases per page">
                                {perItemPageSize}
                            </Select.Trigger>
                            <Select.Content class="bg-popover rounded-xl border-none shadow-2xl">
                                {#each data.perItemPageSizes as size (size)}
                                    <Select.Item
                                        value={String(size)}
                                        label={String(size)}
                                        class="text-xs">
                                        {size}
                                    </Select.Item>
                                {/each}
                            </Select.Content>
                        </Select.Root>
                    </div>
                </div>

                {#if perItemFetchError}
                    <p class="text-destructive text-xs">
                        Could not refresh this section: {perItemFetchError}. The rows below are the
                        last successful fetch.
                    </p>
                {/if}

                {#if perItem.items.length === 0}
                    <p class="text-muted-foreground text-sm">
                        {perItemQuery
                            ? `No per-item blacklisted releases match “${perItemQuery}”.`
                            : "No per-item blacklisted releases."}
                    </p>
                {:else}
                    <div
                        class="flex flex-col divide-y divide-white/5 rounded-xl border border-white/10 transition-opacity {perItemLoading
                            ? 'pointer-events-none opacity-50'
                            : ''}">
                        {#each perItem.items as group (group.item_id)}
                            {@const href = detailHref(group)}
                            {@const groupSelected = groupSelectedCount(group)}
                            <div class="flex flex-col">
                                <!--
                                  The checkbox, the "Open" link and the count badge are
                                  SIBLINGS of the expand trigger, never children: the
                                  trigger is a <button> and bits-ui Checkbox renders one
                                  too, and a nested button is silently reparented by the
                                  SSR parser, which shreds the page on hard refresh.
                                -->
                                <div class="flex items-center gap-3 p-3">
                                    <Checkbox
                                        checked={groupSelected === group.streams.length &&
                                            group.streams.length > 0}
                                        indeterminate={groupSelected > 0 &&
                                            groupSelected < group.streams.length}
                                        aria-label={`Select all ${group.streams.length} blacklisted releases for ${group.title}`}
                                        onCheckedChange={(checked: boolean) =>
                                            toggleGroup(group, !!checked)} />
                                    <button
                                        type="button"
                                        class="flex min-w-0 flex-1 items-center gap-3 text-left"
                                        aria-expanded={!!expanded[group.item_id]}
                                        onclick={() => toggle(group.item_id)}>
                                        <ChevronRight
                                            class="text-muted-foreground h-4 w-4 shrink-0 transition-transform {expanded[
                                                group.item_id
                                            ]
                                                ? 'rotate-90'
                                                : ''}" />
                                        <span class="truncate font-medium">{group.title}</span>
                                        <Badge variant="outline" class="shrink-0 text-[10px]">
                                            {group.type}
                                        </Badge>
                                        {#if group.state}
                                            <Badge
                                                variant="outline"
                                                class="text-muted-foreground shrink-0 text-[10px]">
                                                {group.state}
                                            </Badge>
                                        {/if}
                                    </button>
                                    {#if href}
                                        <a
                                            {href}
                                            class="text-muted-foreground hover:text-foreground shrink-0 text-xs underline-offset-4 hover:underline">
                                            Open
                                        </a>
                                    {/if}
                                    <Badge
                                        variant="outline"
                                        class="shrink-0 font-mono text-xs"
                                        title="{group.count} blacklisted release(s)">
                                        {group.count}
                                    </Badge>
                                </div>

                                {#if expanded[group.item_id]}
                                    <div
                                        class="flex flex-col divide-y divide-white/5 border-t border-white/5 bg-white/[0.02] px-3">
                                        {#each group.streams as stream (stream.relation_id)}
                                            <div class="flex items-start gap-3 py-2">
                                                <Checkbox
                                                    class="mt-1"
                                                    checked={streamKey(
                                                        group.item_id,
                                                        stream.stream_id
                                                    ) in selectedStreams}
                                                    aria-label={`Select ${stream.raw_title}`}
                                                    onCheckedChange={(checked: boolean) =>
                                                        toggleStream(
                                                            group,
                                                            stream.stream_id,
                                                            !!checked
                                                        )} />
                                                <div class="flex min-w-0 flex-1 flex-col gap-1">
                                                    <p class="text-xs break-all">
                                                        {stream.raw_title}
                                                    </p>
                                                    <div
                                                        class="text-muted-foreground flex flex-wrap items-center gap-2 font-mono text-[10px]">
                                                        {#if stream.resolution}
                                                            <span>{stream.resolution}</span>
                                                        {/if}
                                                        {#if stream.rank != null}
                                                            <span>rank {stream.rank}</span>
                                                        {/if}
                                                        {#each stream.flagged_451_services as service (service)}
                                                            <Badge
                                                                variant="outline"
                                                                class="border-destructive/40 text-destructive text-[10px]">
                                                                451 {service}
                                                            </Badge>
                                                        {/each}
                                                        <span class="break-all"
                                                            >{stream.infohash}</span>
                                                    </div>
                                                </div>
                                                <Button
                                                    size="icon-sm"
                                                    variant="ghost"
                                                    disabled={removing ===
                                                        streamKey(group.item_id, stream.stream_id)}
                                                    aria-label={`Remove ${stream.raw_title} from the blacklist for ${group.title}`}
                                                    title="Remove from this item's blacklist"
                                                    class="text-destructive hover:bg-destructive/10 mt-0.5 h-6 w-6 shrink-0"
                                                    onclick={() =>
                                                        unblacklistStream(
                                                            group.item_id,
                                                            stream.stream_id,
                                                            group.title
                                                        )}>
                                                    <Trash2 class="h-3.5 w-3.5" />
                                                </Button>
                                            </div>
                                        {/each}
                                    </div>
                                {/if}
                            </div>
                        {/each}
                    </div>

                    <div class="flex items-center justify-between gap-3">
                        <p class="text-muted-foreground text-xs">
                            {perItem.total_items} item{perItem.total_items === 1 ? "" : "s"},
                            {perItem.total_relations} release{perItem.total_relations === 1
                                ? ""
                                : "s"}
                            {#if !perItemShow451 && perItem.hidden_451 > 0}
                                · {perItem.hidden_451} 451-flagged hidden
                            {/if}
                            {#if selectedStreamCount > 0}
                                · {selectedStreamCount} selected
                            {/if}
                        </p>
                        <div class="flex items-center gap-2">
                            <Button
                                size="sm"
                                variant="secondary"
                                disabled={perItemPageNo <= 1 || perItemLoading}
                                onclick={() => loadPerItem({ page: perItemPageNo - 1 })}>
                                Previous
                            </Button>
                            <span
                                class="text-muted-foreground flex items-center gap-1 font-mono text-xs">
                                {#if perItemLoading}
                                    <Loader2 class="h-3 w-3 animate-spin" />
                                {/if}
                                {perItemPageNo} / {perItemTotalPages}
                            </span>
                            <Button
                                size="sm"
                                variant="secondary"
                                disabled={perItemPageNo >= perItemTotalPages || perItemLoading}
                                onclick={() => loadPerItem({ page: perItemPageNo + 1 })}>
                                Next
                            </Button>
                        </div>
                    </div>
                {/if}
            {/if}
        </section>
    </div>
</PageShell>
