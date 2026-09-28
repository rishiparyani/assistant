CREATE TABLE `admin_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_user_id` text,
	`action` text NOT NULL,
	`detail_json` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`actor_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `admin_audit_created_idx` ON `admin_audit` (`created_at`);--> statement-breakpoint
CREATE TABLE `admins` (
	`email` text PRIMARY KEY NOT NULL,
	`added_by` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`added_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `session_updatedAt_idx` ON `session` (`updatedAt`);--> statement-breakpoint
CREATE INDEX `user_createdAt_idx` ON `user` (`createdAt`);