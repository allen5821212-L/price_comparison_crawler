CREATE TABLE `matching_feedback` (
	`id` int AUTO_INCREMENT NOT NULL,
	`sinya_name` varchar(512) NOT NULL,
	`target_name` varchar(512) NOT NULL,
	`target_id` varchar(255),
	`platform` enum('coolpc','pchome','momo') NOT NULL,
	`created_by_open_id` varchar(64) NOT NULL,
	`active` boolean NOT NULL DEFAULT true,
	`note` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `matching_feedback_id` PRIMARY KEY(`id`),
	CONSTRAINT `matching_feedback_source_platform_unique` UNIQUE(`sinya_name`,`platform`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` int AUTO_INCREMENT NOT NULL,
	`openId` varchar(64) NOT NULL,
	`name` text,
	`email` varchar(320),
	`loginMethod` varchar(64),
	`role` enum('user','admin') NOT NULL DEFAULT 'user',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`lastSignedIn` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_openId_unique` UNIQUE(`openId`)
);
