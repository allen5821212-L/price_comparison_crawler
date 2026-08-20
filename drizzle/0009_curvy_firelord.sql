CREATE TABLE `coolpc_category_recrawl_preset_history` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`preset_id` int,
	`action` enum('applied','jobs_enqueued') NOT NULL,
	`category_names` text NOT NULL,
	`job_ids` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `coolpc_category_recrawl_preset_history_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `coolpc_category_recrawl_presets` ADD `pinned` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `coolpc_category_recrawl_presets` ADD `sort_order` int DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `coolpc_recrawl_preset_history_user_created_idx` ON `coolpc_category_recrawl_preset_history` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `coolpc_recrawl_preset_history_preset_created_idx` ON `coolpc_category_recrawl_preset_history` (`preset_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `coolpc_recrawl_presets_user_pinned_order_idx` ON `coolpc_category_recrawl_presets` (`user_id`,`pinned`,`sort_order`);