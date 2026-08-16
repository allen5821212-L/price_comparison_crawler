CREATE TABLE `crawler_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`job_id` int,
	`comparison_run_id` int,
	`level` enum('info','success','warning','error') NOT NULL,
	`event_type` varchar(64) NOT NULL,
	`title` varchar(512) NOT NULL,
	`message` text,
	`payload` text,
	`read_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `crawler_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `crawler_jobs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`scope` enum('full','category') NOT NULL,
	`trigger` enum('scheduled','manual') NOT NULL,
	`status` enum('queued','running','completed','failed','cancelled') NOT NULL DEFAULT 'queued',
	`category_id` varchar(64),
	`category_name` varchar(512),
	`requested_by_open_id` varchar(64),
	`executor` varchar(128),
	`comparison_run_id` int,
	`summary` text,
	`error_message` text,
	`requested_at` timestamp NOT NULL DEFAULT (now()),
	`started_at` timestamp,
	`finished_at` timestamp,
	CONSTRAINT `crawler_jobs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `price_notifications` (
	`id` int AUTO_INCREMENT NOT NULL,
	`favorite_id` int NOT NULL,
	`comparison_run_id` int,
	`type` enum('price_drop','target_reached') NOT NULL,
	`previous_price` int,
	`current_price` int NOT NULL,
	`title` varchar(512) NOT NULL,
	`message` text,
	`read_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `price_notifications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `product_favorites` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`source_key` varchar(128) NOT NULL,
	`sinya_name` varchar(1024) NOT NULL,
	`target_price` int,
	`last_known_price` int,
	`active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `product_favorites_id` PRIMARY KEY(`id`),
	CONSTRAINT `product_favorites_user_source_unique` UNIQUE(`user_id`,`source_key`)
);
--> statement-breakpoint
CREATE INDEX `crawler_events_created_idx` ON `crawler_events` (`created_at`);--> statement-breakpoint
CREATE INDEX `crawler_events_job_idx` ON `crawler_events` (`job_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `crawler_jobs_queue_idx` ON `crawler_jobs` (`status`,`requested_at`);--> statement-breakpoint
CREATE INDEX `crawler_jobs_requester_idx` ON `crawler_jobs` (`requested_by_open_id`,`requested_at`);--> statement-breakpoint
CREATE INDEX `price_notifications_favorite_created_idx` ON `price_notifications` (`favorite_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `product_favorites_user_active_idx` ON `product_favorites` (`user_id`,`active`);