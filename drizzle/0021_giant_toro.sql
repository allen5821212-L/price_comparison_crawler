CREATE TABLE `brand_aliases` (
	`id` int AUTO_INCREMENT NOT NULL,
	`alias` varchar(128) NOT NULL,
	`canonical_name` varchar(128) NOT NULL,
	`active` boolean NOT NULL DEFAULT true,
	`created_by_open_id` varchar(64) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `brand_aliases_id` PRIMARY KEY(`id`),
	CONSTRAINT `brand_aliases_alias_unique` UNIQUE(`alias`)
);
--> statement-breakpoint
CREATE INDEX `brand_aliases_canonical_active_idx` ON `brand_aliases` (`canonical_name`,`active`);