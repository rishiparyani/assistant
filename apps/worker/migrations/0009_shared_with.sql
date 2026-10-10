CREATE TABLE `shared_with` (
	`user_id` text NOT NULL,
	`share_id` text NOT NULL,
	`space_id` text NOT NULL,
	`joined_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shared_with_pk` ON `shared_with` (`user_id`,`share_id`);--> statement-breakpoint
CREATE INDEX `shared_with_space_idx` ON `shared_with` (`space_id`);