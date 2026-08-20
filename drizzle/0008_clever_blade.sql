CREATE TABLE `coolpc_category_recrawl_presets` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`name` varchar(64) NOT NULL,
	`category_names` text NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `coolpc_category_recrawl_presets_id` PRIMARY KEY(`id`),
	CONSTRAINT `coolpc_recrawl_presets_user_name_unique` UNIQUE(`user_id`,`name`)
);
--> statement-breakpoint
CREATE INDEX `coolpc_recrawl_presets_user_updated_idx` ON `coolpc_category_recrawl_presets` (`user_id`,`updated_at`);