CREATE TABLE `match_review_escalation_settings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`active` boolean NOT NULL DEFAULT true,
	`escalate_after_minutes` int NOT NULL DEFAULT 60,
	`reminder_interval_minutes` int NOT NULL DEFAULT 30,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `match_review_escalation_settings_id` PRIMARY KEY(`id`),
	CONSTRAINT `match_review_escalation_settings_user_unique` UNIQUE(`user_id`)
);
--> statement-breakpoint
CREATE TABLE `match_review_mentions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`activity_log_id` int NOT NULL,
	`mentioned_user_id` int NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`read_at` timestamp,
	CONSTRAINT `match_review_mentions_id` PRIMARY KEY(`id`),
	CONSTRAINT `match_review_mentions_activity_user_unique` UNIQUE(`activity_log_id`,`mentioned_user_id`)
);
--> statement-breakpoint
CREATE INDEX `match_review_mentions_unread_user_idx` ON `match_review_mentions` (`mentioned_user_id`,`read_at`,`created_at`);