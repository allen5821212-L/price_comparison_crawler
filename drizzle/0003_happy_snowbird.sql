CREATE TABLE `comparison_matches` (
	`id` int AUTO_INCREMENT NOT NULL,
	`run_id` int NOT NULL,
	`source_key` varchar(128) NOT NULL,
	`sinya_name` varchar(1024) NOT NULL,
	`coolpc_name` varchar(1024),
	`pchome_name` varchar(1024),
	`momo_name` varchar(1024),
	`category` varchar(512),
	`sinya_price` int NOT NULL,
	`coolpc_price` int NOT NULL,
	`pchome_price` int,
	`momo_price` int,
	`price_diff` int NOT NULL,
	`cheaper` enum('sinya','coolpc','pchome','momo','tie') NOT NULL,
	`score` decimal(7,4) NOT NULL,
	`has_spec_diff` boolean NOT NULL DEFAULT false,
	`payload` text NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `comparison_matches_id` PRIMARY KEY(`id`),
	CONSTRAINT `comparison_matches_run_source_unique` UNIQUE(`run_id`,`source_key`)
);
--> statement-breakpoint
CREATE TABLE `comparison_price_history` (
	`id` int AUTO_INCREMENT NOT NULL,
	`snapshot_date` date NOT NULL,
	`source_key` varchar(128) NOT NULL,
	`sinya_name` varchar(1024) NOT NULL,
	`coolpc_name` varchar(1024),
	`pchome_name` varchar(1024),
	`momo_name` varchar(1024),
	`sinya_price` int NOT NULL,
	`coolpc_price` int NOT NULL,
	`pchome_price` int,
	`momo_price` int,
	`price_diff` int NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `comparison_price_history_id` PRIMARY KEY(`id`),
	CONSTRAINT `comparison_history_daily_source_unique` UNIQUE(`snapshot_date`,`source_key`)
);
--> statement-breakpoint
CREATE TABLE `comparison_products` (
	`id` int AUTO_INCREMENT NOT NULL,
	`platform` enum('sinya','coolpc','pchome','momo') NOT NULL,
	`external_id` varchar(255) NOT NULL,
	`name` varchar(1024) NOT NULL,
	`subtitle` text,
	`price` int NOT NULL,
	`original_price` int,
	`url` text,
	`image` text,
	`category` varchar(512),
	`last_seen_run_id` int NOT NULL,
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `comparison_products_id` PRIMARY KEY(`id`),
	CONSTRAINT `comparison_products_platform_external_unique` UNIQUE(`platform`,`external_id`)
);
--> statement-breakpoint
CREATE TABLE `comparison_runs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`status` enum('running','completed','failed') NOT NULL DEFAULT 'running',
	`sinya_total` int NOT NULL DEFAULT 0,
	`coolpc_total` int NOT NULL DEFAULT 0,
	`pchome_total` int NOT NULL DEFAULT 0,
	`momo_total` int NOT NULL DEFAULT 0,
	`matched_total` int NOT NULL DEFAULT 0,
	`sinya_cheaper` int NOT NULL DEFAULT 0,
	`coolpc_cheaper` int NOT NULL DEFAULT 0,
	`pchome_cheaper` int NOT NULL DEFAULT 0,
	`momo_cheaper` int NOT NULL DEFAULT 0,
	`same_price` int NOT NULL DEFAULT 0,
	`avg_price_diff` decimal(12,2) NOT NULL DEFAULT '0',
	`sinya_categories` text,
	`error_message` text,
	`started_at` timestamp NOT NULL DEFAULT (now()),
	`finished_at` timestamp,
	CONSTRAINT `comparison_runs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `comparison_matches_current_match_idx` ON `comparison_matches` (`run_id`,`category`,`cheaper`);--> statement-breakpoint
CREATE INDEX `comparison_matches_score_idx` ON `comparison_matches` (`run_id`,`score`);--> statement-breakpoint
CREATE INDEX `comparison_history_product_idx` ON `comparison_price_history` (`source_key`,`snapshot_date`);--> statement-breakpoint
CREATE INDEX `comparison_products_current_catalog_idx` ON `comparison_products` (`last_seen_run_id`,`platform`,`category`);--> statement-breakpoint
CREATE INDEX `comparison_runs_status_finished_idx` ON `comparison_runs` (`status`,`finished_at`);