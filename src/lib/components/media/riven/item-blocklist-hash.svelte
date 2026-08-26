<script lang="ts">
    import providers from "$lib/providers";
    import { toast } from "svelte-sonner";
    import * as AlertDialog from "$lib/components/ui/alert-dialog/index.js";
    import { Button } from "$lib/components/ui/button/index.js";
    import { invalidateAll } from "$app/navigation";
    import { createScopedLogger } from "$lib/logger";

    const logger = createScopedLogger("item-blocklist-hash");

    import { type Snippet } from "svelte";

    interface Props {
        title: string | null | undefined;
        // Riven item id (the currently-grabbed file lives on this item's active_stream).
        itemId: number | string | null | undefined;
        // Current filename (display only, so the user knows what they're ditching).
        filename?: string | null;
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
        itemId,
        filename = null,
        variant = "secondary",
        size = "sm",
        children,
        ...restProps
    }: Props = $props();

    let open = $state(false);
    let loading = $state(false);

    async function blocklistCurrentHash() {
        if (itemId == null) {
            toast.error("No Riven item id; cannot blocklist current file.");
            return;
        }
        loading = true;
        try {
            // New endpoint (patch 0029): reads active_stream.infohash server-side,
            // adds it to the global blocklist (excluded_items.infohashes), then
            // re-scrapes. Not in the generated openapi spec yet -> cast the path.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const resp = await (providers.riven.POST as any)(
                "/api/v1/items/{item_id}/blocklist_active",
                { params: { path: { item_id: Number(itemId) } } }
            );
            if (resp?.error) {
                logger.error("blocklist_active failed:", resp.error);
                toast.error(
                    `Failed to blocklist current file: ${
                        resp.error?.detail ?? "unknown error"
                    }`
                );
                return;
            }
            toast.success(
                `Blocklisted current file for "${title ?? "item"}" — re-scraping a different release.`
            );
            invalidateAll();
        } catch (e) {
            logger.error("blocklist_active exception:", e);
            toast.error(
                `Blocklist current file failed: ${e instanceof Error ? e.message : e}`
            );
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
                aria-label={`Blocklist current file for ${title ?? "media item"}`}
                {...restProps}
                {...props}
                disabled={loading}>
                {#if children}
                    {@render children()}
                {:else}
                    Blocklist current file
                {/if}
            </Button>
        {/snippet}
    </AlertDialog.Trigger>
    <AlertDialog.Content class="border border-white/10 bg-zinc-950/95 backdrop-blur-2xl">
        <AlertDialog.Header>
            <AlertDialog.Title>Blocklist current file</AlertDialog.Title>
            <AlertDialog.Description>
                Blocklists this release's infohash everywhere and re-scrapes
                "{title ?? "this item"}".
                {#if filename}
                    <span class="text-foreground mt-2 block font-mono text-xs break-all">
                        {filename}
                    </span>
                {/if}
            </AlertDialog.Description>
        </AlertDialog.Header>
        <AlertDialog.Footer>
            <AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
            <AlertDialog.Action
                onclick={() => {
                    open = false;
                    blocklistCurrentHash();
                }}>
                Blocklist & re-scrape
            </AlertDialog.Action>
        </AlertDialog.Footer>
    </AlertDialog.Content>
</AlertDialog.Root>
