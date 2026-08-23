CREATE TABLE `coolpc_category_recrawl_reminders` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`category_name` varchar(512) NOT NULL,
	`active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `coolpc_category_recrawl_reminders_id` PRIMARY KEY(`id`),
	CONSTRAINT `coolpc_recrawl_reminders_user_category_unique` UNIQUE(`user_id`,`category_name`)
);
--> statement-breakpoint
CREATE INDEX `coolpc_recrawl_reminders_user_active_idx` ON `coolpc_category_recrawl_reminders` (`user_id`,`active`);