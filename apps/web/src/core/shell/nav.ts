// The app's main navigation (no workspaces; docs/design/gig-centric.md §2).
export interface NavItem {
  href: string;
  label: string;
  icon: "home" | "gigs" | "people" | "band" | "reports" | "settings";
  exact?: boolean;
}

export const MAIN_NAV: NavItem[] = [
  { href: "/", label: "Home", icon: "home", exact: true },
  { href: "/gigs", label: "Gigs", icon: "gigs" },
  { href: "/reports", label: "Reports", icon: "reports" },
  { href: "/contacts", label: "Contacts", icon: "people" },
  { href: "/settings", label: "Settings", icon: "settings" },
];
