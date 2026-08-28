CREATE TABLE `review_api_degradation_alerts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`check_id` varchar(64) NOT NULL,
	`incident_key` varchar(256) NOT NULL,
	`title` varchar(256) NOT NULL,
	`message` text NOT NULL,
	`read_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `review_api_degradation_alerts_id` PRIMARY KEY(`id`),
	CONSTRAINT `review_api_degradation_alerts_user_incident_unique` UNIQUE(`user_id`,`incident_key`)
);
--> statement-breakpoint
CREATE TABLE `review_api_health_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`check_id` varchar(64) NOT NULL,
	`check_label` varchar(128) NOT NULL,
	`status` enum('healthy','degraded') NOT NULL,
	`duration_ms` int NOT NULL,
	`message` text,
	`observed_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `review_api_health_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `review_api_health_monitor_settings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`active` boolean NOT NULL DEFAULT true,
	`degradation_threshold_minutes` int NOT NULL DEFAULT 15,
	`schedule_cron_task_uid` varchar(65),
	`last_checked_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `review_api_health_monitor_settings_id` PRIMARY KEY(`id`),
	CONSTRAINT `review_api_health_monitor_task_uid_unique` UNIQUE(`schedule_cron_task_uid`)
);
--> statement-breakpoint
CREATE INDEX `review_api_degradation_alerts_user_read_created_idx` ON `review_api_degradation_alerts` (`user_id`,`read_at`,`created_at`);--> statement-breakpoint
CREATE INDEX `review_api_health_events_check_observed_idx` ON `review_api_health_events` (`check_id`,`observed_at`);--> statement-breakpoint
CREATE INDEX `review_api_health_events_status_observed_idx` ON `review_api_health_events` (`status`,`observed_at`);