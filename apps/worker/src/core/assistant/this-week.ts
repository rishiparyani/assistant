// This week (home-first.md §2 point 13): once a week, one message of proposals in each
// person's chat, made from their data (never from the model): a quick add for a list they keep
// adding to by hand, a reminder workflow for dates that go by, a finished card to take off the
// home. Proposals, never actions: each is a confirm card the person taps.
import { spaceName } from "../spaces/service.ts";
import type { Proposal } from "../spaces/space-object.ts";
import { notify } from "../push/notify.ts";

/** How long a proposal can be tapped: until the next week's arrive. */
const WEEK_MINUTES = 7 * 24 * 60;

/** Monday, 09:00 India time (03:30 UTC), in the quarter hour the cron runs. */
export const thisWeekDue = (now: Date) =>
  now.getUTCDay() === 1 && now.getUTCHours() === 3 && now.getUTCMinutes() >= 30 && now.getUTCMinutes() < 45;

/** Everyone with a personal space who has the assistant (owners, admins, people switched on). */
export async function people(env: Env): Promise<{ user_id: string; space_id: string }[]> {
  const owners = (env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  const rows = await env.DB.prepare(
    `select s.id as space_id, s.owner_user_id as user_id, lower(u.email) as email,
            (select 1 from assistant_access a where a.user_id = s.owner_user_id) as on_,
            (select 1 from admins d where d.email = lower(u.email)) as admin
     from spaces s join "user" u on u.id = s.owner_user_id where s.kind = 'personal'`,
  ).all<{ space_id: string; user_id: string; email: string; on_: number | null; admin: number | null }>();
  const anyOwner = owners.length > 0 || rows.results.some((r) => r.admin);
  return rows.results
    .filter((r) => !anyOwner || r.on_ || r.admin || owners.includes(r.email))
    .map((r) => ({ user_id: r.user_id, space_id: r.space_id }));
}

/** One person's proposals, posted to their main chat as cards (and one notification). */
export async function proposeWeek(env: Env, userId: string, spaceId: string, now: Date): Promise<number> {
  const since = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const space = env.SPACES.getByName(spaceName(spaceId));
  const proposals: Proposal[] = await space.proposals({ userId, source: "system" }, since);
  if (!proposals.length) return 0;
  const chat = env.CHATS.get(env.CHATS.idFromName(`chat:${userId}`));
  // Once a week, whatever the cron does (a retried run, two runs in the quarter hour).
  if (!(await chat.claimOnce(userId, `this-week:${weekOf(now)}`))) return 0;
  const rows = [];
  rows.push({
    role: "assistant" as const,
    content: `This week: ${proposals.length} idea${proposals.length === 1 ? "" : "s"} from what you did. Tap the ones you want; nothing happens otherwise.`,
    shown: "assistant" as const,
  });
  for (const p of proposals) {
    // Tappable all week (a confirm card lasts 30 minutes; this one waits for the person).
    const id = await chat.addAction(
      userId,
      { tool: p.tool, args: p.args, title: p.title, details: [p.why, ...p.details] },
      WEEK_MINUTES,
    );
    rows.push({ role: "assistant" as const, content: p.title, shown: "card" as const, card_action_id: id });
  }
  await chat.append(userId, rows);
  await notify(env, userId, {
    kind: "this_week",
    title: "This week",
    body: proposals.map((p) => p.title).join(" · "),
    url: "/",
  });
  return proposals.length;
}

/** The Monday (UTC date) of the week this time falls in. */
export function weekOf(now: Date): string {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

export async function runThisWeek(env: Env, now: Date): Promise<void> {
  for (const p of await people(env)) {
    try {
      await proposeWeek(env, p.user_id, p.space_id, now);
    } catch (e) {
      console.error("this week failed", p.user_id, e instanceof Error ? e.message : String(e));
    }
  }
}
