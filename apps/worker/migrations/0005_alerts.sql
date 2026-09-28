CREATE TABLE `alert_state` (
	`id` text PRIMARY KEY NOT NULL,
	`firing` text DEFAULT 'no' NOT NULL,
	`message` text,
	`since` text,
	`last_sent_at` text
);
--> statement-breakpoint
CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `dead_letters` (
	`id` text PRIMARY KEY NOT NULL,
	`gig_id` text NOT NULL,
	`seq` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `dead_letters_created_idx` ON `dead_letters` (`created_at`);