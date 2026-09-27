// The "Me" Home: what concerns the signed-in person, across all their workspaces
// (decision 2026-09-27). Only their own amounts; never other people's shares.
import type { WorkspaceKind } from "../../core/workspaces.ts";
import type { GigView } from "./gigs.ts";

type Money = { amount_paise: number; amount_display: string };
type WorkspaceRef = { id: string; name: string; kind: WorkspaceKind };

export interface MyGig {
  gig: GigView;
  workspace: WorkspaceRef;
  /**
   * "playing": I'm in the lineup. "own": a gig in my personal workspace.
   * "lineup_not_set": a collective gig with no lineup yet.
   */
  involvement: "playing" | "own" | "lineup_not_set";
  /** My share (collectives) or what I keep (personal: fee minus others' shares). Null if not known yet. */
  my_amount: Money | null;
  my_role: string | null;
}

export interface MyWorkspaceMoney {
  workspace: WorkspaceRef;
  amount: Money;
  /** Gigs (owed to me) or people (I owe) behind the amount. */
  count: number;
}

export interface MyHomeView {
  /** Next gigs across my workspaces, soonest first (max 8). */
  upcoming: MyGig[];
  this_month: {
    label: string;
    /** My shares (collectives) plus what I keep (personal) for gigs played so far this month. */
    earned: Money;
    /** Paid to me this month: payouts from collectives plus client payments in my personal workspace. */
    received: Money;
    gigs: number;
  };
  /** Played gigs not fully paid to me: collectives' payouts owed to me, clients owing my personal workspace. */
  owed_to_me: { total: Money; by_workspace: MyWorkspaceMoney[] };
  /** Collectives I own: shares still owed to other musicians for played gigs. */
  i_owe: { total: Money; by_workspace: MyWorkspaceMoney[] };
  /** Collectives where I'm not on the roster (my shares can't be shown). `can_fix`: I'm the owner. */
  not_on_roster: (WorkspaceRef & { can_fix: boolean })[];
}
