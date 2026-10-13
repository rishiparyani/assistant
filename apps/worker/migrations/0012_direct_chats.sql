CREATE TABLE `direct_chats` (
	`pair` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
