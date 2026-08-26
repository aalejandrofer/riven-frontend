<script lang="ts">
    import { onMount } from "svelte";
    import { invalidateAll } from "$app/navigation";
    import { resolve } from "$app/paths";
    import PageShell from "$lib/components/page-shell.svelte";
    import { Badge } from "$lib/components/ui/badge/index.js";
    import { Button } from "$lib/components/ui/button/index.js";
    import RefreshCw from "@lucide/svelte/icons/refresh-cw";

    type QueueEvent = {
        emitted_by: string;
        item_id: number | null;
        item_type: string | null;
        external_id: string | null;
        media_type: string | null;
        display_title: string | null;
        item_state: string | null;
        run_at: string;
        log_message: string;
    };

    function linkHref(ev: QueueEvent): string | null {
        if (!ev.external_id || !ev.media_type) return null;
        return `/details/media/${ev.external_id}/${ev.media_type}`;
    }

    function labelFor(ev: QueueEvent): string {
        return ev.display_title || ev.log_message;
    }
    type Executor = { service_name: string; worker_count: number };
    type PageData = {
        queued_count: number;
        running_count: number;
        queued: QueueEvent[];
        running: QueueEvent[];
        executors: Executor[];
        overview: {
            runner_count: number;
            runners_failing: number;
            tasks_pending: number;
            tasks_failed: number;
        } | null;
    };

    let { data }: { data: PageData } = $props();

    let autoRefresh = $state(true);
    let timer: ReturnType<typeof setInterval> | null = null;

    function fmtTime(iso: string) {
        const d = new Date(iso);
        return d.toLocaleTimeString();
    }

    onMount(() => {
        timer = setInterval(() => {
            if (autoRefresh) invalidateAll();
        }, 3000);
        return () => {
            if (timer) clearInterval(timer);
        };
    });
</script>

<svelte:head>
    <title>Monitor · Queue - Riven</title>
</svelte:head>

<PageShell class="mt-0 h-full md:mt-4">
    <div class="mx-auto flex w-full max-w-6xl flex-col gap-8">
        <header class="flex flex-wrap items-center justify-between gap-4">
            <div>
                <h1 class="font-heading text-3xl font-bold tracking-tight">Queue</h1>
                <p class="text-muted-foreground text-sm">
                    EventManager snapshot — refreshes every 3s.
                </p>
            </div>
            <div class="flex items-center gap-2">
                <Button
                    size="sm"
                    variant={autoRefresh ? "default" : "secondary"}
                    onclick={() => (autoRefresh = !autoRefresh)}>
                    {autoRefresh ? "Auto-refresh on" : "Auto-refresh off"}
                </Button>
                <Button size="sm" variant="secondary" onclick={() => invalidateAll()}>
                    <RefreshCw class="mr-1.5 h-3.5 w-3.5" />
                    Refresh
                </Button>
            </div>
        </header>

        <section class="grid grid-cols-2 gap-4 md:grid-cols-4">
            <div class="rounded-xl border border-white/10 p-4">
                <p class="text-muted-foreground text-xs uppercase tracking-wide">Queued</p>
                <p class="font-heading mt-1 text-3xl font-bold">{data.queued_count}</p>
            </div>
            <div class="rounded-xl border border-white/10 p-4">
                <p class="text-muted-foreground text-xs uppercase tracking-wide">Running</p>
                <p class="font-heading mt-1 text-3xl font-bold">{data.running_count}</p>
            </div>
            <a
                href={resolve("/monitor/runners")}
                class="rounded-xl border border-white/10 p-4 transition-colors hover:bg-white/5">
                <p class="text-muted-foreground text-xs uppercase tracking-wide">Runners</p>
                <p class="font-heading mt-1 text-3xl font-bold">
                    {data.overview?.runner_count ?? "—"}
                    {#if data.overview?.runners_failing}
                        <span class="ml-1 align-middle text-base font-semibold text-red-400"
                            >{data.overview.runners_failing} failing</span>
                    {/if}
                </p>
            </a>
            <a
                href={resolve("/monitor/runners")}
                class="rounded-xl border border-white/10 p-4 transition-colors hover:bg-white/5">
                <p class="text-muted-foreground text-xs uppercase tracking-wide">Scheduled</p>
                <p class="font-heading mt-1 text-3xl font-bold">
                    {data.overview?.tasks_pending ?? "—"}
                    {#if data.overview?.tasks_failed}
                        <span class="ml-1 align-middle text-base font-semibold text-amber-400"
                            >{data.overview.tasks_failed} failed</span>
                    {/if}
                </p>
            </a>
        </section>

        <section class="flex flex-col gap-4">
            <h2 class="font-heading text-xl font-semibold">
                Running
                <Badge variant="outline" class="ml-2 font-mono text-xs">{data.running.length}</Badge>
            </h2>
            {#if data.running.length === 0}
                <p class="text-muted-foreground text-sm">No running events.</p>
            {:else}
                <div class="overflow-hidden rounded-xl border border-white/10">
                    <table class="w-full text-sm">
                        <thead class="bg-white/5 text-xs uppercase tracking-wide">
                            <tr>
                                <th class="px-3 py-2 text-left">Item</th>
                                <th class="px-3 py-2 text-left">Service</th>
                                <th class="px-3 py-2 text-left">State</th>
                                <th class="px-3 py-2 text-left">Since</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-white/5">
                            {#each data.running as ev (`${ev.item_id}-${ev.run_at}`)}
                                <tr>
                                    <td class="px-3 py-2 font-mono">
                                        {#if linkHref(ev)}
                                            <a class="hover:underline" href={linkHref(ev)}>
                                                {labelFor(ev)}
                                            </a>
                                        {:else}
                                            {labelFor(ev)}
                                        {/if}
                                    </td>
                                    <td class="px-3 py-2">
                                        <Badge variant="outline">{ev.emitted_by}</Badge>
                                    </td>
                                    <td class="px-3 py-2 text-muted-foreground text-xs">
                                        {ev.item_state ?? "—"}
                                    </td>
                                    <td class="px-3 py-2 font-mono text-xs">
                                        {fmtTime(ev.run_at)}
                                    </td>
                                </tr>
                            {/each}
                        </tbody>
                    </table>
                </div>
            {/if}
        </section>

        <section class="flex flex-col gap-4">
            <h2 class="font-heading text-xl font-semibold">
                Queued
                <Badge variant="outline" class="ml-2 font-mono text-xs">{data.queued.length}</Badge>
            </h2>
            {#if data.queued.length === 0}
                <p class="text-muted-foreground text-sm">Queue empty.</p>
            {:else}
                <div class="overflow-hidden rounded-xl border border-white/10">
                    <table class="w-full text-sm">
                        <thead class="bg-white/5 text-xs uppercase tracking-wide">
                            <tr>
                                <th class="px-3 py-2 text-left">Item</th>
                                <th class="px-3 py-2 text-left">Emitted by</th>
                                <th class="px-3 py-2 text-left">State</th>
                                <th class="px-3 py-2 text-left">Run at</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-white/5">
                            {#each data.queued.slice(0, 200) as ev (`${ev.item_id}-${ev.run_at}`)}
                                {@const future = new Date(ev.run_at).getTime() > Date.now() + 1000}
                                <tr class={future ? "opacity-60" : ""}>
                                    <td class="px-3 py-2 font-mono">
                                        {#if linkHref(ev)}
                                            <a class="hover:underline" href={linkHref(ev)}>
                                                {labelFor(ev)}
                                            </a>
                                        {:else}
                                            {labelFor(ev)}
                                        {/if}
                                    </td>
                                    <td class="px-3 py-2">
                                        <Badge variant="outline">{ev.emitted_by}</Badge>
                                    </td>
                                    <td class="px-3 py-2 text-muted-foreground text-xs">
                                        {ev.item_state ?? "—"}
                                    </td>
                                    <td class="px-3 py-2 font-mono text-xs">
                                        {fmtTime(ev.run_at)}{future ? " (scheduled)" : ""}
                                    </td>
                                </tr>
                            {/each}
                        </tbody>
                    </table>
                    {#if data.queued.length > 200}
                        <p class="text-muted-foreground p-3 text-center text-xs">
                            Showing first 200 of {data.queued.length}.
                        </p>
                    {/if}
                </div>
            {/if}
        </section>
    </div>
</PageShell>
