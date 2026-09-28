CREATE TABLE `access_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`sealed` text,
	`scopes` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`last_used_at` text,
	`revoked_at` text,
	`request_key` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `access_tokens_hash_idx` ON `access_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `access_tokens_user_idx` ON `access_tokens` (`user_id`,`kind`);--> statement-breakpoint
CREATE INDEX `access_tokens_request_idx` ON `access_tokens` (`request_key`);--> statement-breakpoint
CREATE TABLE `user_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`source` text NOT NULL,
	`action` text NOT NULL,
	`entity_id` text NOT NULL,
	`detail_json` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `user_audit_user_idx` ON `user_audit` (`user_id`,`created_at`);