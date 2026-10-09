// The app's main navigation (no workspaces; docs/design/gig-centric.md §2).
export interface NavItem {
  href: string;
  label: string;
  icon: "home" | "chat" | "gigs" | "collections" | "songs" | "people" | "band" | "reports" | "settings";
  exact?: boolean;
  /** Left out of the phone's tab bar (Settings is under the avatar there). */
  phone?: false;
}

export const MAIN_NAV: NavItem[] = [
  { href: "/", label: "Chat", icon: "chat", exact: true },
  // The gig app's home (upcoming gigs, money); on phones it's in Settings.
  { href: "/overview", label: "Overview", icon: "home", phone: false },
  { href: "/gigs", label: "Gigs", icon: "gigs" },
  { href: "/c", label: "Collections", icon: "collections" },
  { href: "/songs", label: "Songs", icon: "songs" },
  // On phones, Reports is in Settings (the tab bar keeps five).
  { href: "/reports", label: "Reports", icon: "reports", phone: false },
  { href: "/contacts", label: "Contacts", icon: "people" },
  { href: "/settings", label: "Settings", icon: "settings", phone: false },
];
