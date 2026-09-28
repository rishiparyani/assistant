-- Retire workspaces (R1 step 7, owner's OK 2026-09-28): the old workspace-based gigs
-- and collectives. Prod held test data only. Tables that point at others go first.
PRAGMA defer_foreign_keys = true;--> statement-breakpoint
DROP TABLE `payouts`;--> statement-breakpoint
DROP TABLE `gig_lineup`;--> statement-breakpoint
DROP TABLE `payments`;--> statement-breakpoint
DROP TABLE `expenses`;--> statement-breakpoint
DROP TABLE `musicians`;--> statement-breakpoint
DROP TABLE `gigs`;--> statement-breakpoint
DROP TABLE `clients`;--> statement-breakpoint
DROP TABLE `venues`;--> statement-breakpoint
DROP TABLE `api_tokens`;--> statement-breakpoint
DROP TABLE `audit_log`;--> statement-breakpoint
DROP TABLE `confirm_tokens`;--> statement-breakpoint
DROP TABLE `idempotency_keys`;--> statement-breakpoint
DROP TABLE `workspace_modules`;--> statement-breakpoint
DROP TABLE `invitation`;--> statement-breakpoint
DROP TABLE `member`;--> statement-breakpoint
DROP TABLE `organization`;
