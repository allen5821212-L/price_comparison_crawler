CREATE TABLE `coolpc_category_recrawl_preset_template_collaborators` (
	`id` int AUTO_INCREMENT NOT NULL,
	`template_id` int NOT NULL,
	`user_id` int NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `coolpc_category_recrawl_preset_template_collaborators_id` PRIMARY KEY(`id`),
	CONSTRAINT `coolpc_recrawl_template_collaborators_unique` UNIQUE(`template_id`,`user_id`)
);
--> statement-breakpoint
ALTER TABLE `coolpc_category_recrawl_preset_templates` ADD `collaboration_mode` enum('read_only','collaborative') DEFAULT 'read_only' NOT NULL;--> statement-breakpoint
CREATE INDEX `coolpc_recrawl_template_collaborators_user_idx` ON `coolpc_category_recrawl_preset_template_collaborators` (`user_id`,`template_id`);