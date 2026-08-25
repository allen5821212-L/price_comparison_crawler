CREATE TABLE `match_review_activity_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`source_key` varchar(128) NOT NULL,
	`fingerprint` varchar(64) NOT NULL,
	`type` enum('comment','handoff') NOT NULL,
	`author_user_id` int NOT NULL,
	`from_user_id` int,
	`to_user_id` int,
	`message` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `match_review_activity_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `match_review_activity_logs_review_created_idx` ON `match_review_activity_logs` (`source_key`,`fingerprint`,`created_at`);--> statement-breakpoint
CREATE INDEX `match_review_activity_logs_author_created_idx` ON `match_review_activity_logs` (`author_user_id`,`created_at`);