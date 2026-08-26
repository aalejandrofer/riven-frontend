<script lang="ts">
    import { page } from "$app/state";
    import NotificationCenter from "$lib/components/notification-center.svelte";
    import * as Avatar from "$lib/components/ui/avatar/index.js";
    import { getInitials } from "$lib/utils";
    import { resolve } from "$app/paths";
    import CalendarDays from "@lucide/svelte/icons/calendar-days";
    import Activity from "@lucide/svelte/icons/activity";
    import Home from "@lucide/svelte/icons/home";
    import LayoutDashboard from "@lucide/svelte/icons/layout-dashboard";
    import Ban from "@lucide/svelte/icons/ban";
    import Mountain from "@lucide/svelte/icons/mountain";
    import Settings from "@lucide/svelte/icons/settings";
    import Library from "@lucide/svelte/icons/library";
    import { getContext } from "svelte";
    import Tooltip from "./tooltip.svelte";
    import { fly } from "svelte/transition";
    import { cubicOut } from "svelte/easing";
    import type { createSidebarStore } from "$lib/stores/global.svelte";

    // Grouped by what you do with them: browse (home/dashboard), the library and
    // the two views onto it (calendar, blocklist), then operations.
    //
    // No Explore entry: /explore is the search RESULTS page, reached from the
    // header search bar and Cmd+K. With its landing content removed it has
    // nothing to show until you type, so a nav link led to a blank page.
    //
    // No Profile entry either - the avatar at the bottom of this same sidebar
    // already links to /auth.
    const navItems = [
        { href: "/", icon: Home, label: "Home" },
        { href: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
        { href: "/library", icon: Library, label: "Library" },
        { href: "/calendar", icon: CalendarDays, label: "Calendar" },
        { href: "/blocklist", icon: Ban, label: "Blocklist" },
        { href: "/monitor", icon: Activity, label: "Monitor" },
        { href: "/settings", icon: Settings, label: "Settings" }
    ] as const;

    let { user } = $props();

    const SidebarStore = getContext<ReturnType<typeof createSidebarStore>>("sidebarStore");
</script>

<aside
    class="bg-background/40 top-0 left-0 z-50 hidden h-screen w-14 flex-col items-center border-r border-white/5 backdrop-blur-md md:flex">
    <div class="flex h-18 w-full shrink-0 items-center justify-center">
        <a
            href={resolve("/")}
            class="text-primary hover:bg-accent/80 flex h-10 w-10 items-center justify-center rounded-md transition-colors"
            aria-label="Riven home">
            <Mountain class="size-5" />
        </a>
    </div>
    <!-- flex-1 + justify-center makes the nav own the space between the logo and
         the footer and grow from its middle, so the icon group stays vertically
         centred however many entries it has. -->
    <nav
        class="flex flex-1 flex-col items-center justify-center gap-3.5"
        aria-label="Main Navigation">
        {#each navItems as item (item.href)}
            <Tooltip>
                {#snippet trigger()}
                    <a
                        data-sveltekit-preload-data={item.label === "Settings" ? "off" : "hover"}
                        href={resolve(item.href)}
                        class="hover:bg-accent/80 group relative flex h-10 w-10 items-center justify-center rounded-md transition-colors"
                        class:bg-accent={page.url.pathname === resolve(item.href)}
                        aria-label={item.label}
                        aria-current={page.url.pathname === resolve(item.href)
                            ? "page"
                            : undefined}>
                        <item.icon class="size-5" />
                    </a>
                {/snippet}
                {#snippet content()}
                    <p>
                        {item.label}
                    </p>
                {/snippet}
            </Tooltip>
        {/each}
    </nav>

    <div class="flex shrink-0 flex-col items-center gap-3.5 pb-4">
        <NotificationCenter
            variant="ghost"
            side="right"
            align="end"
            class="hover:bg-accent/80 group rounded-md transition-colors" />
        {#if user}
            <Tooltip>
                {#snippet trigger()}
                    <a href={resolve("/auth")} class="cursor-pointer" aria-label="Profile">
                        <Avatar.Root>
                            {#if user.image}
                                <Avatar.Image src={user.image} alt={user.name} />
                            {/if}
                            <Avatar.Fallback class="bg-primary text-primary-foreground">
                                {getInitials(user.name)}
                            </Avatar.Fallback>
                        </Avatar.Root>
                    </a>
                {/snippet}
                {#snippet content()}
                    <p class="font-medium">
                        {user.name}
                    </p>
                {/snippet}
            </Tooltip>
        {:else}
            <a href={resolve("/auth/login")} class="cursor-pointer" aria-label="Login">
                <Avatar.Root>
                    <Avatar.Fallback class="bg-primary text-primary-foreground">
                        {getInitials("Guest")}
                    </Avatar.Fallback>
                </Avatar.Root>
            </a>
        {/if}
    </div>
</aside>

{#if SidebarStore.isOpen}
    <!-- Backdrop -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
        onclick={() => SidebarStore.toggle()}
        role="button"
        tabindex="0"
        onkeydown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
                SidebarStore.toggle();
            }
        }}
        class="fixed inset-0 z-40 cursor-default md:hidden">
    </div>

    <!-- Pop-out Menu -->
    <div
        transition:fly={{ y: 10, duration: 200, easing: cubicOut }}
        class="fixed right-4 bottom-24 z-50 flex w-72 origin-bottom-right flex-col overflow-hidden rounded-2xl border border-white/10 bg-zinc-950/80 shadow-2xl shadow-black/50 backdrop-blur-xl md:hidden">
        <div class="p-3">
            {#if user}
                <div class="mb-4 flex items-center justify-between px-2">
                    <a
                        href={resolve("/auth")}
                        class="flex items-center gap-3"
                        onclick={() => SidebarStore.toggle()}>
                        <Avatar.Root class="size-8">
                            {#if user.image}
                                <Avatar.Image src={user.image} alt={user.name} />
                            {/if}
                            <Avatar.Fallback class="bg-primary text-primary-foreground text-xs">
                                {getInitials(user.name)}
                            </Avatar.Fallback>
                        </Avatar.Root>
                        <p class="text-foreground/90 text-sm font-medium">
                            {user.username}
                        </p>
                    </a>

                </div>
            {:else}
                <div class="mb-4 flex items-center gap-3 px-2">
                    <Avatar.Root class="size-8">
                        <Avatar.Fallback class="bg-primary text-primary-foreground">
                            {getInitials("Guest")}
                        </Avatar.Fallback>
                    </Avatar.Root>
                    <p class="text-sm font-medium">Guest</p>
                </div>
            {/if}

            <nav class="flex flex-col gap-1" aria-label="Mobile Navigation">
                {#each navItems as item (item.href)}
                    <a
                        href={resolve(item.href)}
                        onclick={() => SidebarStore.toggle()}
                        class="hover:text-foreground flex w-full items-center gap-3 rounded-xl px-4 py-2.5 text-sm font-medium transition-colors hover:bg-white/10
						{page.url.pathname === resolve(item.href) ? 'text-primary bg-white/10' : 'text-muted-foreground'}"
                        aria-current={page.url.pathname === resolve(item.href)
                            ? "page"
                            : undefined}>
                        <item.icon class="size-4" />
                        <span>{item.label}</span>
                    </a>
                {/each}
            </nav>
        </div>
    </div>
{/if}
