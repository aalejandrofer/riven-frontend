<script lang="ts">
    import type { ActionData, PageData } from "./$types";
    import { BasicForm } from "@sjsf/form";
    import { createMeta, setupSvelteKitForm } from "@sjsf/sveltekit/client";
    import * as defaults from "$lib/components/settings/form-defaults";
    import { setShadcnContext } from "$lib/components/shadcn-context";
    import { toast } from "svelte-sonner";
    import { icons } from "@sjsf/lucide-icons";
    import PageShell from "$lib/components/page-shell.svelte";
    import { Input } from "$lib/components/ui/input/index.js";
    import { onMount, onDestroy } from "svelte";
    import Search from "@lucide/svelte/icons/search";
    import Maximize2 from "@lucide/svelte/icons/maximize-2";
    import Minimize2 from "@lucide/svelte/icons/minimize-2";
    setShadcnContext();

    let { data }: { data: PageData } = $props();

    const meta = createMeta<ActionData, PageData>().form;

    // @ts-expect-error - Schema is provided by page data
    const { form } = setupSvelteKitForm(meta, {
        ...defaults,
        icons,
        delayedMs: 500,
        timeoutMs: 30000,
        onSuccess: (result) => {
            if (result.type === "success") {
                toast.success("Settings saved");
            } else {
                // eslint-disable-next-line no-console
                console.error("[settings save] non-success result", result);
                toast.error(`Failed to save settings: ${result.type}`);
            }
        },
        onFailure: (error: unknown) => {
            // eslint-disable-next-line no-console
            console.error("[settings save] onFailure", error);
            const msg = error instanceof Error ? error.message : JSON.stringify(error);
            toast.error(`Save error: ${msg?.slice(0, 200)}`);
        }
    });

    type Section = { key: string; title: string };

    const sections: Section[] = $derived(
        // @ts-expect-error - schema is dynamic
        Object.entries((data.form.schema as any)?.properties ?? {}).map(([key, val]) => ({
            key,
            title: (val as any)?.title ?? key
        }))
    );

    // ---- Master-detail nav model -----------------------------------------
    // Each nav entry maps to one OR MORE schema keys. Lets us fold the loose
    // top-level scalars into "General" and bucket debug flags under Advanced.
    // Display-only: friendly titles + grouping; values/keys untouched.
    type NavDef = { id: string; group: string; title: string; keys: string[] };
    const NAV_DEF: NavDef[] = [
        { id: "general", group: "Setup", title: "General", keys: ["log_level", "retry_interval"] },
        { id: "storage", group: "Setup", title: "Storage & Library", keys: ["filesystem"] },
        { id: "servers", group: "Setup", title: "Media Servers", keys: ["updaters"] },
        { id: "down", group: "Sources", title: "Debrid / Downloaders", keys: ["downloaders"] },
        { id: "content", group: "Sources", title: "Content Sources", keys: ["content"] },
        { id: "scrapers", group: "Sources", title: "Scrapers", keys: ["scraping"] },
        { id: "ranking", group: "Quality", title: "Ranking & Quality", keys: ["ranking"] },
        { id: "indexing", group: "Quality", title: "Indexing", keys: ["indexer"] },
        { id: "notif", group: "Alerts", title: "Notifications", keys: ["notifications"] },
        { id: "subs", group: "Alerts", title: "Subtitles & Post", keys: ["post_processing"] },
        { id: "database", group: "Advanced", title: "Database", keys: ["database"] },
        { id: "stream", group: "Advanced", title: "Streaming", keys: ["stream"] },
        { id: "logging", group: "Advanced", title: "Logging", keys: ["logging"] },
        {
            id: "debug",
            group: "Advanced",
            title: "Debug",
            keys: ["enable_network_tracing", "enable_stream_tracing", "tracemalloc"]
        }
    ];

    // Build the live nav from NAV_DEF ∩ schema keys; any unmapped schema key
    // falls into an "Other" (Advanced) entry so nothing is ever lost.
    type NavEntry = NavDef;
    const nav: NavEntry[] = $derived.by(() => {
        const present = new Set(sections.map((s) => s.key));
        const used = new Set<string>();
        const out: NavEntry[] = [];
        for (const d of NAV_DEF) {
            const keys = d.keys.filter((k) => present.has(k));
            keys.forEach((k) => used.add(k));
            if (keys.length) out.push({ ...d, keys });
        }
        const leftover = sections.map((s) => s.key).filter((k) => !used.has(k));
        if (leftover.length)
            out.push({ id: "other", group: "Advanced", title: "Other", keys: leftover });
        return out;
    });

    const groups: string[] = $derived([...new Set(nav.map((e) => e.group))]);

    const FORM_ID = "riven-settings-form";
    let query = $state("");
    let activeId = $state("");
    let expanded = $state(false);
    let formContainer: HTMLDivElement | undefined = $state();
    let formEl: HTMLFormElement | undefined = $state();

    // schema key -> its rendered section element (heading-bearing container)
    let sectionEls = $state<Map<string, HTMLElement>>(new Map());

    const terms: string[] = $derived(query.trim().toLowerCase().split(/\s+/).filter(Boolean));

    // token-AND match across the entry title + each mapped section's textContent
    // (hyphen/underscore-insensitive → "real debrid" hits "Real-Debrid")
    function entryMatches(e: NavEntry): boolean {
        if (!terms.length) return true;
        let hay = e.title;
        for (const k of e.keys) {
            const el = sectionEls.get(k);
            if (el) hay += " " + (el.textContent ?? "");
        }
        hay = hay.toLowerCase().replace(/[-_]/g, " ");
        return terms.every((t) => hay.includes(t));
    }

    const filteredNav: NavEntry[] = $derived(nav.filter(entryMatches));
    const activeEntry: NavEntry | undefined = $derived(
        filteredNav.find((e) => e.id === activeId) ?? filteredNav[0]
    );

    function indexSections() {
        if (!formContainer) return;
        // sjsf (shadcn4 theme) renders the root object's properties inside the
        // first `[data-slot="field-group"]`; each top-level property — object
        // (fieldset) OR scalar (div) — is one direct child, in schema-property
        // order. Map by DOM order (title/id matching is unreliable: scalars are
        // plain divs and keys contain underscores = the id separator).
        const group = formContainer.querySelector<HTMLElement>('[data-slot="field-group"]');
        const next = new Map<string, HTMLElement>();
        if (group) {
            const kids = Array.from(group.children) as HTMLElement[];
            sections.forEach((sec, i) => {
                if (kids[i]) next.set(sec.key, kids[i]);
            });
        }
        sectionEls = next;
    }

    // BasicForm renders its SubmitButton as the LAST button in the form
    // (form.svelte: <Content/> then <SubmitButton/>, onsubmit={ctx.submit}).
    function nativeSubmit(): HTMLElement | null {
        const btns = formContainer?.querySelectorAll<HTMLElement>("form button");
        return btns && btns.length ? btns[btns.length - 1] : null;
    }
    // Hide BasicForm's own submit button — we drive submit from our pinned bar.
    function hideNativeSubmit() {
        const btn = nativeSubmit();
        if (btn) btn.style.display = "none";
    }

    // Show only the active entry's section element(s); hide the rest.
    $effect(() => {
        const keys = new Set(activeEntry?.keys ?? []);
        for (const [k, el] of sectionEls.entries()) {
            el.style.display = keys.has(k) ? "" : "none";
        }
    });

    function resetChanges() {
        // discard unsaved edits by re-fetching settings from the backend
        location.reload();
    }

    let mo: MutationObserver | undefined;
    onMount(() => {
        if (!formContainer) return;
        if (formEl) formEl.id = FORM_ID; // associate our external Save button
        indexSections();
        hideNativeSubmit();
        mo = new MutationObserver(() => {
            if (formEl && formEl.id !== FORM_ID) formEl.id = FORM_ID;
            indexSections();
            hideNativeSubmit();
        });
        mo.observe(formContainer, { childList: true, subtree: true });
    });
    onDestroy(() => {
        mo?.disconnect();
    });
</script>

<svelte:head>
    <title>Settings - Riven</title>
</svelte:head>

<svelte:window onkeydown={(e) => e.key === "Escape" && expanded && (expanded = false)} />

<PageShell class="h-full">
    <div class="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 lg:flex-row">
        <!-- Section rail -->
        <aside class="lg:sticky lg:top-6 lg:w-60 lg:self-start">
            <div class="rounded-xl border border-white/10 bg-zinc-900/40 p-3">
                <div class="relative mb-3">
                    <Search
                        class="text-muted-foreground absolute top-1/2 left-2 h-3.5 w-3.5 -translate-y-1/2" />
                    <Input
                        bind:value={query}
                        placeholder="Filter settings..."
                        class="h-8 pl-7 text-xs" />
                </div>
                <nav
                    class="flex max-h-[calc(100vh-12rem)] flex-col gap-3 overflow-y-auto pb-1"
                    aria-label="Settings sections">
                    {#each groups as g (g)}
                        {@const entries = filteredNav.filter((e) => e.group === g)}
                        {#if entries.length}
                            <div>
                                <div
                                    class="text-muted-foreground px-2 pb-1 text-[10px] font-semibold tracking-wider uppercase">
                                    {g}
                                </div>
                                <div class="flex flex-col gap-0.5">
                                    {#each entries as e (e.id)}
                                        <button
                                            type="button"
                                            class="rounded-md px-2.5 py-1.5 text-left text-sm transition-colors {activeEntry?.id ===
                                            e.id
                                                ? 'bg-primary/15 text-primary'
                                                : 'text-muted-foreground hover:bg-accent/60'}"
                                            onclick={() => (activeId = e.id)}>
                                            {e.title}
                                        </button>
                                    {/each}
                                </div>
                            </div>
                        {/if}
                    {/each}
                    {#if filteredNav.length === 0}
                        <div class="text-muted-foreground px-2 py-2 text-xs">No matches</div>
                    {/if}
                </nav>
            </div>
        </aside>

        <!-- Detail pane: only the active section renders; Save bar pinned in-card -->
        <main
            class={expanded
                ? "fixed inset-0 z-50 flex flex-col bg-zinc-950"
                : "flex h-[calc(100vh-7rem)] min-w-0 flex-1 flex-col rounded-xl border border-white/10 bg-zinc-900/30"}>
            <div class="flex items-center justify-end border-b border-white/10 px-3 py-1.5">
                <button
                    type="button"
                    aria-label={expanded ? "Collapse" : "Expand to full screen"}
                    title={expanded ? "Collapse (Esc)" : "Expand to full screen"}
                    class="text-muted-foreground hover:bg-accent/60 hover:text-foreground rounded-md p-1.5 transition-colors"
                    onclick={() => (expanded = !expanded)}>
                    {#if expanded}
                        <Minimize2 class="h-4 w-4" />
                    {:else}
                        <Maximize2 class="h-4 w-4" />
                    {/if}
                </button>
            </div>
            <div
                bind:this={formContainer}
                class="min-h-0 flex-1 overflow-y-auto px-6 py-6 {expanded
                    ? 'mx-auto w-full max-w-4xl'
                    : ''}">
                <BasicForm bind:ref={formEl} {form} method="POST" id={FORM_ID}></BasicForm>
            </div>
            <div class="flex items-center justify-end gap-2 border-t border-white/10 px-6 py-2">
                <button
                    type="button"
                    class="text-muted-foreground hover:bg-accent/60 inline-flex h-8 items-center justify-center rounded-md px-3 text-xs transition-colors"
                    onclick={resetChanges}>
                    Reset
                </button>
                <button
                    type="submit"
                    form={FORM_ID}
                    class="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex h-8 items-center justify-center rounded-md px-4 text-xs font-medium transition-colors">
                    Save
                </button>
            </div>
        </main>
    </div>
</PageShell>
