CREATE TABLE `coolpc_category_recrawl_preset_templates` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`preset_id` int NOT NULL,
	`share_token` varchar(64) NOT NULL,
	`active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `coolpc_category_recrawl_preset_templates_id` PRIMARY KEY(`id`),
	CONSTRAINT `coolpc_recrawl_preset_templates_preset_unique` UNIQUE(`preset_id`),
	CONSTRAINT `coolpc_recrawl_preset_templates_token_unique` UNIQUE(`share_token`)
);
--> statement-breakpoint
CREATE INDEX `coolpc_recrawl_preset_templates_user_active_idx` ON `coolpc_category_recrawl_preset_templates` (`user_id`,`active`);