CREATE TABLE `pending_people` (
	`email` text NOT NULL,
	`gig_id` text NOT NULL,
	`person_id` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pending_people_email_person_uidx` ON `pending_people` (`email`,`gig_id`,`person_id`);--> statement-breakpoint
CREATE TABLE `tags` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`created_by` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "tags_kind_check" CHECK("tags"."kind" in ('collective', 'custom'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_kind_name_uidx` ON `tags` (`kind`,`name_key`);