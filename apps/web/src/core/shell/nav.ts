// The app's main navigation (no workspaces; docs/design/gig-centric.md §2).
export interface NavItem {
  href: string;
  label: string;
  icon: "home" | "gigs" | "songs" | "people" | "band" | "reports" | "settings";
  exact?: boolean;
  /** Left out of the phone's tab bar (Settings is under the avatar there). */
  phone?: false;
}

export const MAIN_NAV: NavItem[] = [
  { href: "/", label: "Home", icon: "home", exact: true },
  { href: "/gigs", label: "Gigs", icon: "gigs" },
  { href: "/songs", label: "Songs", icon: "songs" },
  { href: "/reports", label: "Reports", icon: "reports" },
  { href: "/contacts", label: "Contacts", icon: "people" },
  { href: "/settings", label: "Settings", icon: "settings", phone: false },
];
