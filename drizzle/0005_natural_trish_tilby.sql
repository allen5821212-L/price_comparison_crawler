CREATE TABLE `crawler_issue_reports` (
	`id` int AUTO_INCREMENT NOT NULL,
	`job_id` int NOT NULL,
	`severity` enum('low','medium','high','critical') NOT NULL DEFAULT 'medium',
	`issue_label` enum('crawler','data','source') NOT NULL DEFAULT 'crawler',
	`issue_draft_url` text NOT NULL,
	`error_summary` text,
	`created_by_open_id` varchar(64) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `crawler_issue_reports_id` PRIMARY KEY(`id`),
	CONSTRAINT `crawler_issue_reports_job_unique` UNIQUE(`job_id`)
);
--> statement-breakpoint
CREATE INDEX `crawler_issue_reports_created_idx` ON `crawler_issue_reports` (`created_at`);