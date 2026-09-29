ALTER TABLE `user_audit` ADD `request_key` text;--> statement-breakpoint
CREATE INDEX `user_audit_request_idx` ON `user_audit` (`user_id`,`request_key`);