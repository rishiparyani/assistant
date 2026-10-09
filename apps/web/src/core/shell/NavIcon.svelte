<script lang="ts">
  import House from "@lucide/svelte/icons/house";
  import CalendarDays from "@lucide/svelte/icons/calendar-days";
  import Contact from "@lucide/svelte/icons/contact";
  import Users from "@lucide/svelte/icons/users";
  import Settings from "@lucide/svelte/icons/settings";
  import ChartColumn from "@lucide/svelte/icons/chart-column";
  import Music from "@lucide/svelte/icons/music";
  import Layers from "@lucide/svelte/icons/layers";
  import MessageCircle from "@lucide/svelte/icons/message-circle";
  import type { NavItem } from "./nav.ts";

  let {
    icon,
    size = 22,
    active = false,
  }: { icon: NavItem["icon"]; size?: number; active?: boolean } = $props();
  const strokeWidth = $derived(active ? 2.3 : 1.8);
</script>

{#if icon === "home"}<House {size} {strokeWidth} />
{:else if icon === "gigs"}<CalendarDays {size} {strokeWidth} />
{:else if icon === "chat"}<MessageCircle {size} {strokeWidth} />
{:else if icon === "collections"}<Layers {size} {strokeWidth} />
{:else if icon === "songs"}<Music {size} {strokeWidth} />
{:else if icon === "people"}<Contact {size} {strokeWidth} />
{:else if icon === "band"}<Users {size} {strokeWidth} />
{:else if icon === "reports"}<ChartColumn {size} {strokeWidth} />
{:else}<Settings {size} {strokeWidth} />{/if}
