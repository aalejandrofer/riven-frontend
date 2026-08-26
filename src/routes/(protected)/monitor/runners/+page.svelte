<script lang="ts">
    import { onMount } from "svelte";
    import { invalidateAll } from "$app/navigation";
    import PageShell from "$lib/components/page-shell.svelte";
    import { Badge } from "$lib/components/ui/badge/index.js";
    import { Button } from "$lib/components/ui/button/index.js";
    import RefreshCw from "@lucide/svelte/icons/refresh-cw";

    type Runner = {
        id: string;
        label: string;
        interval_seconds: number | null;
        trigger: string | null;
        next_run: string | null;
        running: boolean;
        last_started: string | null;
        last_finished: string | null;
        last_duration_ms: number | null;
        last_ok: boolean | null;
        last_error: string | null;
    };

    type Task = {
        id: number;
        task_type: string;
        status: string;
        scheduled_for: string | null;
        executed_at: string | null;
        item_id: number | null;
        title: string | null;
        reason: string | null;
    };

    type Pool = {
        service_name: string;
        worker_count: number;
        in_flight: number;
        cap: number;
        at_cap: boolean;
    };

    type PageData = {
        runners: Runner[];
        pools: Pool[];
        task_counts: Record<string, number>;
        task_types: { task_type: string; status: string; count: number }[];
        upcoming: Task[];
        recent: Task[];
    };

    let { data }: { data: PageData } = $props();

    let autoRefresh = $state(true);
    let timer: ReturnType<typeof setInterval> | null = null;

    // Ticks once a second purely so the countdowns move between server refreshes.
    let now = $state(Date.now());

    /** "in 42s" / "in 6h 02m" — or "now" when it is already due. */
    function until(iso: string | null): string {
        if (!iso) return "—";
        const delta = new Date(iso).getTime() - now;
        if (delta <= 0) return "now";
        const s = Math.round(delta / 1000);
        if (s < 60) return `${s}s`;
        const m = Math.floor(s / 60);
        if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
        const h = Math.floor(m / 60);
        if (h < 24) return `${h}h ${String(m % 60).padStart(2, "0")}m`;
        return `${Math.floor(h / 24)}d ${h % 24}h`;
    }

    function ago(iso: string | null): string {
        if (!iso) return "never";
        const s = Math.round((now - new Date(iso).getTime()) / 1000);
        if (s < 0) return "just now";
        if (s < 60) return `${s}s ago`;
        const m = Math.floor(s / 60);
        if (m < 60) return `${m}m ago`;
        const h = Math.floor(m / 60);
        if (h < 24) return `${h}h ago`;
        return `${Math.floor(h / 24)}d ago`;
    }

    function every(seconds: number | null): string {
        if (!seconds) return "one-shot";
        if (seconds < 60) return `${seconds}s`;
        const m = Math.floor(seconds / 60);
        if (m < 60) return `${m}m`;
        const h = Math.floor(m / 60);
        if (h < 24) return `${h}h`;
        return `${Math.floor(h / 24)}d`;
    }

    function duration(ms: number | null): string {
        if (ms === null || ms === undefined) return "";
        if (ms < 1000) return `${ms}ms`;
        return `${(ms / 1000).toFixed(1)}s`;
    }

    /** Reasons are all prefixed "monitor:"; the prefix carries no information. */
    function reason(value: string | null): string {
        if (!value) return "—";
        return value.startsWith("monitor:") ? value.slice("monitor:".length) : value;
    }

    function when(iso: string | null): string {
        if (!iso) return "—";
        return new Date(iso).toLocaleString();
    }

    const failing = $derived(data.runners.filter((r) => r.last_ok === false));
    const atCap = $derived(data.pools.filter((p) => p.at_cap));
    const pending = $derived(data.task_counts["Pending"] ?? data.task_counts["pending"] ?? 0);
    const failed = $derived(data.task_counts["Failed"] ?? data.task_counts["failed"] ?? 0);

    onMount(() => {
        const tick = setInterval(() => (now = Date.now()), 1000);
        timer = setInterval(() => {
            if (autoRefresh) invalidateAll();
        }, 5000);
        return () => {
            clearInterval(tick);
            if (timer) clearInterval(timer);
        };
    });
</script>

<svelte:head>
    <title>Monitor · Runners - Riven</title>
</svelte:head>

<PageShell class="mt-0 h-full md:mt-4">
    <div class="mx-auto flex w-full max-w-6xl flex-col gap-8">
        <header class="flex flex-wrap items-center justify-between gap-4">
            <div>
                <h1 class="font-heading text-3xl font-bold tracking-tight">Runners</h1>
                <p class="text-muted-foreground text-sm">
                    Periodic jobs and the work they schedule — refreshes every 5s.
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

        <section class="grid grid-cols-1 gap-4 md:grid-cols-4">
            <div class="rounded-xl border border-white/10 p-4">
                <p class="text-muted-foreground text-xs uppercase tracking-wide">Runners</p>
                <p class="font-heading mt-1 text-3xl font-bold">{data.runners.length}</p>
            </div>
            <div class="rounded-xl border border-white/10 p-4">
                <p class="text-muted-foreground text-xs uppercase tracking-wide">Failing</p>
                <p
                    class="font-heading mt-1 text-3xl font-bold {failing.length
                        ? 'text-red-400'
                        : ''}">
                    {failing.length}
                </p>
            </div>
            <div class="rounded-xl border border-white/10 p-4">
                <p class="text-muted-foreground text-xs uppercase tracking-wide">Tasks pending</p>
                <p class="font-heading mt-1 text-3xl font-bold">{pending}</p>
            </div>
            <div class="rounded-xl border border-white/10 p-4">
                <p class="text-muted-foreground text-xs uppercase tracking-wide">Tasks failed</p>
                <p class="font-heading mt-1 text-3xl font-bold {failed ? 'text-amber-400' : ''}">
                    {failed}
                </p>
            </div>
        </section>

        <section class="flex flex-col gap-4">
            <h2 class="font-heading text-xl font-semibold">
                Periodic jobs
                <Badge variant="outline" class="ml-2 font-mono text-xs">{data.runners.length}</Badge>
            </h2>
            {#if data.runners.length === 0}
                <p class="text-muted-foreground text-sm">
                    Scheduler is not running, or no jobs are registered.
                </p>
            {:else}
                <div class="overflow-x-auto rounded-xl border border-white/10">
                    <table class="w-full min-w-[46rem] text-sm">
                        <thead class="bg-white/5 text-xs uppercase tracking-wide">
                            <tr>
                                <th class="px-3 py-2 text-left">Job</th>
                                <th class="px-3 py-2 text-left">Every</th>
                                <th class="px-3 py-2 text-left">Next run</th>
                                <th class="px-3 py-2 text-left">Last run</th>
                                <th class="px-3 py-2 text-left">Result</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-white/5">
                            {#each data.runners as r (r.id)}
                                <tr class={r.running ? "bg-primary/5" : ""}>
                                    <td class="px-3 py-2">
                                        <span class="font-medium">{r.label}</span>
                                        {#if r.running}
                                            <Badge class="ml-2 text-[10px]">running</Badge>
                                        {/if}
                                        <div class="text-muted-foreground font-mono text-[11px]">
                                            {r.id}
                                        </div>
                                    </td>
                                    <td class="text-muted-foreground px-3 py-2 font-mono"
                                        >{every(r.interval_seconds)}</td>
                                    <td class="px-3 py-2 font-mono">{until(r.next_run)}</td>
                                    <td class="text-muted-foreground px-3 py-2"
                                        >{ago(r.last_finished)}</td>
                                    <td class="px-3 py-2">
                                        {#if r.last_ok === null || r.last_ok === undefined}
                                            <span class="text-muted-foreground">—</span>
                                        {:else if r.last_ok}
                                            <span class="text-emerald-400">ok</span>
                                            <span class="text-muted-foreground ml-1 font-mono text-xs"
                                                >{duration(r.last_duration_ms)}</span>
                                        {:else}
                                            <span class="text-red-400" title={r.last_error ?? ""}
                                                >failed</span>
                                        {/if}
                                    </td>
                                </tr>
                            {/each}
                        </tbody>
                    </table>
                </div>
            {/if}
        </section>

        <section class="grid grid-cols-1 gap-8 lg:grid-cols-2">
            <div class="flex flex-col gap-4">
                <h2 class="font-heading text-xl font-semibold">
                    Upcoming
                    <Badge variant="outline" class="ml-2 font-mono text-xs"
                        >{data.upcoming.length}</Badge>
                </h2>
                {#if data.upcoming.length === 0}
                    <p class="text-muted-foreground text-sm">Nothing scheduled.</p>
                {:else}
                    <div class="overflow-x-auto rounded-xl border border-white/10">
                        <table class="w-full min-w-[30rem] text-sm">
                            <thead class="bg-white/5 text-xs uppercase tracking-wide">
                                <tr>
                                    <th class="px-3 py-2 text-left">Item</th>
                                    <th class="px-3 py-2 text-left">Task</th>
                                    <th class="px-3 py-2 text-left">Reason</th>
                                    <th class="px-3 py-2 text-left">In</th>
                                </tr>
                            </thead>
                            <tbody class="divide-y divide-white/5">
                                {#each data.upcoming as t (t.id)}
                                    <tr>
                                        <td class="px-3 py-2"
                                            >{t.title ?? `#${t.item_id ?? t.id}`}</td>
                                        <td class="text-muted-foreground px-3 py-2 font-mono text-xs"
                                            >{t.task_type}</td>
                                        <td
                                            class="text-muted-foreground px-3 py-2 font-mono text-xs"
                                            title={t.reason ?? ""}>{reason(t.reason)}</td>
                                        <td
                                            class="px-3 py-2 font-mono"
                                            title={when(t.scheduled_for)}
                                            >{until(t.scheduled_for)}</td>
                                    </tr>
                                {/each}
                            </tbody>
                        </table>
                    </div>
                {/if}
            </div>

            <div class="flex flex-col gap-4">
                <h2 class="font-heading text-xl font-semibold">
                    Just ran
                    <Badge variant="outline" class="ml-2 font-mono text-xs"
                        >{data.recent.length}</Badge>
                </h2>
                {#if data.recent.length === 0}
                    <p class="text-muted-foreground text-sm">Nothing has run yet.</p>
                {:else}
                    <div class="overflow-x-auto rounded-xl border border-white/10">
                        <table class="w-full min-w-[30rem] text-sm">
                            <thead class="bg-white/5 text-xs uppercase tracking-wide">
                                <tr>
                                    <th class="px-3 py-2 text-left">Item</th>
                                    <th class="px-3 py-2 text-left">Task</th>
                                    <th class="px-3 py-2 text-left">Reason</th>
                                    <th class="px-3 py-2 text-left">When</th>
                                    <th class="px-3 py-2 text-left">Status</th>
                                </tr>
                            </thead>
                            <tbody class="divide-y divide-white/5">
                                {#each data.recent as t (t.id)}
                                    <tr>
                                        <td class="px-3 py-2"
                                            >{t.title ?? `#${t.item_id ?? t.id}`}</td>
                                        <td class="text-muted-foreground px-3 py-2 font-mono text-xs"
                                            >{t.task_type}</td>
                                        <td
                                            class="text-muted-foreground px-3 py-2 font-mono text-xs"
                                            title={t.reason ?? ""}>{reason(t.reason)}</td>
                                        <td class="px-3 py-2" title={when(t.executed_at)}
                                            >{ago(t.executed_at)}</td>
                                        <td class="px-3 py-2">
                                            {#if t.status === "Failed" || t.status === "failed"}
                                                <span class="text-red-400">failed</span>
                                            {:else}
                                                <span class="text-emerald-400">{t.status}</span>
                                            {/if}
                                        </td>
                                    </tr>
                                {/each}
                            </tbody>
                        </table>
                    </div>
                {/if}
            </div>
        </section>

        {#if data.pools.length}
            <section class="flex flex-col gap-4">
                <h2 class="font-heading text-xl font-semibold">
                    Executor pools
                    {#if atCap.length}
                        <Badge class="ml-2 bg-amber-500/20 text-amber-300"
                            >{atCap.length} at cap</Badge>
                    {/if}
                </h2>
                <p class="text-muted-foreground -mt-2 text-sm">
                    In-flight work per service against the patch 0021 cap. At the cap the
                    dispatcher stops submitting and re-queues with backoff.
                </p>
                <div class="grid grid-cols-2 gap-3 md:grid-cols-4">
                    {#each data.pools as p (p.service_name)}
                        <div
                            class="rounded-lg border p-3 {p.at_cap
                                ? 'border-amber-400/40 bg-amber-500/5'
                                : 'border-white/10'}">
                            <p class="font-mono text-xs">{p.service_name}</p>
                            <p class="mt-1 flex items-baseline gap-1.5">
                                <span
                                    class="font-heading text-lg font-bold {p.in_flight
                                        ? ''
                                        : 'text-muted-foreground'}"
                                    >{p.in_flight}/{p.cap}</span>
                                <span class="text-muted-foreground text-xs">in flight</span>
                            </p>
                            <div class="mt-1.5 h-1 overflow-hidden rounded-full bg-white/10">
                                <div
                                    class="h-full rounded-full {p.at_cap
                                        ? 'bg-amber-400'
                                        : 'bg-primary'}"
                                    style="width: {Math.min(100, (p.in_flight / p.cap) * 100)}%">
                                </div>
                            </div>
                            <p class="text-muted-foreground mt-1.5 text-xs">
                                {p.worker_count} worker{p.worker_count === 1 ? "" : "s"}{p.at_cap
                                    ? " · at cap"
                                    : ""}
                            </p>
                        </div>
                    {/each}
                </div>
            </section>
        {/if}

        {#if data.task_types.length}
            <section class="flex flex-col gap-4">
                <h2 class="font-heading text-xl font-semibold">Scheduled work by type</h2>
                <div class="overflow-x-auto rounded-xl border border-white/10">
                    <table class="w-full min-w-[28rem] text-sm">
                        <thead class="bg-white/5 text-xs uppercase tracking-wide">
                            <tr>
                                <th class="px-3 py-2 text-left">Task type</th>
                                <th class="px-3 py-2 text-left">Status</th>
                                <th class="px-3 py-2 text-right">Count</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-white/5">
                            {#each data.task_types as row (`${row.task_type}-${row.status}`)}
                                <tr>
                                    <td class="px-3 py-2 font-mono text-xs">{row.task_type}</td>
                                    <td class="text-muted-foreground px-3 py-2">{row.status}</td>
                                    <td class="px-3 py-2 text-right font-mono">{row.count}</td>
                                </tr>
                            {/each}
                        </tbody>
                    </table>
                </div>
            </section>
        {/if}
    </div>
</PageShell>
