// The Worker's timer (wrangler `triggers.crons`, every 15 minutes): health checks and
// alerts every run, plus jobs that modules or core schedule for certain hours.
import type { ModuleDefinition } from "./module.ts";
import { runAlerts } from "./alerts/service.ts";

export type ScheduledJob = {
  id: string;
  /** Runs when this returns true for the run's time (e.g. once a night). */
  due: (now: Date) => boolean;
  run: (env: Env, now: Date) => Promise<void>;
};

export function scheduledHandler(modules: readonly ModuleDefinition[], jobs: readonly ScheduledJob[] = []) {
  return async (controller: ScheduledController, env: Env, ctx: ExecutionContext) => {
    const now = new Date(controller.scheduledTime);
    ctx.waitUntil(runAlerts(env, modules, now).catch((err) => console.error("alerts: run failed", err)));
    for (const job of jobs) {
      if (!job.due(now)) continue;
      ctx.waitUntil(job.run(env, now).catch((err) => console.error(`scheduled: ${job.id} failed`, err)));
    }
  };
}
