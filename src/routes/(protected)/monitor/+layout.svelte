<script lang="ts">
    import { page } from "$app/state";
    import { resolve } from "$app/paths";
    import ListChecks from "@lucide/svelte/icons/list-checks";
    import FileClock from "@lucide/svelte/icons/file-clock";
    import Timer from "@lucide/svelte/icons/timer";

    let { children } = $props();

    const tabs = [
        { href: "/monitor", icon: ListChecks, label: "Queue" },
        { href: "/monitor/runners", icon: Timer, label: "Runners" },
        { href: "/monitor/logs", icon: FileClock, label: "Logs" }
    ];

    // "/monitor" is a prefix of every sibling, so check the children first.
    const activeHref = $derived(
        page.url.pathname.startsWith(resolve("/monitor/logs"))
            ? "/monitor/logs"
            : page.url.pathname.startsWith(resolve("/monitor/runners"))
              ? "/monitor/runners"
              : "/monitor"
    );
</script>

<div class="flex h-full min-h-0 flex-col">
    <div class="px-6 pt-6 md:px-16 md:pt-14">
        <div
            class="inline-flex items-center gap-1 rounded-xl border border-white/10 bg-zinc-900/40 p-1"
            role="tablist"
            aria-label="Monitor views">
            {#each tabs as tab (tab.href)}
                <a
                    href={resolve(tab.href)}
                    role="tab"
                    aria-selected={activeHref === tab.href}
                    class="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors {activeHref ===
                    tab.href
                        ? 'bg-primary/15 text-primary'
                        : 'text-muted-foreground hover:bg-white/5'}">
                    <tab.icon class="size-4" />
                    {tab.label}
                </a>
            {/each}
        </div>
    </div>
    <div class="min-h-0 flex-1">
        {@render children?.()}
    </div>
</div>
