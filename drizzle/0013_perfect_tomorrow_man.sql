CREATE TABLE `match_review_assignments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`source_key` varchar(128) NOT NULL,
	`fingerprint` varchar(64) NOT NULL,
	`assignee_user_id` int NOT NULL,
	`assigned_by_open_id` varchar(64) NOT NULL,
	`status` enum('assigned','resolved') NOT NULL DEFAULT 'assigned',
	`due_at` timestamp NOT NULL,
	`resolved_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `match_review_assignments_id` PRIMARY KEY(`id`),
	CONSTRAINT `match_review_assignments_source_fingerprint_unique` UNIQUE(`source_key`,`fingerprint`)
);
--> statement-breakpoint
CREATE TABLE `match_review_notification_settings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`medium_threshold` int NOT NULL DEFAULT 0,
	`high_threshold` int NOT NULL DEFAULT 1,
	`critical_threshold` int NOT NULL DEFAULT 1,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `match_review_notification_settings_id` PRIMARY KEY(`id`),
	CONSTRAINT `match_review_notification_settings_user_unique` UNIQUE(`user_id`)
);
--> statement-breakpoint
CREATE INDEX `match_review_assignments_assignee_due_idx` ON `match_review_assignments` (`assignee_user_id`,`status`,`due_at`);--> statement-breakpoint
CREATE INDEX `match_review_assignments_status_due_idx` ON `match_review_assignments` (`status`,`due_at`);