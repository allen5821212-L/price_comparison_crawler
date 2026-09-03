CREATE TABLE `match_negative_features` (
	`id` int AUTO_INCREMENT NOT NULL,
	`platform` enum('coolpc','pchome','momo') NOT NULL,
	`source_feature` varchar(128) NOT NULL,
	`target_feature` varchar(128) NOT NULL,
	`rejection_count` int NOT NULL DEFAULT 1,
	`last_rejected_by_user_id` int NOT NULL,
	`last_source_name` varchar(1024) NOT NULL,
	`last_target_name` varchar(1024) NOT NULL,
	`last_rejected_at` timestamp NOT NULL DEFAULT (now()),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `match_negative_features_id` PRIMARY KEY(`id`),
	CONSTRAINT `match_negative_features_pair_unique` UNIQUE(`platform`,`source_feature`,`target_feature`)
);
--> statement-breakpoint
ALTER TABLE `comparison_price_history` ADD `state_fingerprint` varchar(64);--> statement-breakpoint
ALTER TABLE `comparison_price_history` ADD `is_suspect_price` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `comparison_products` ADD `is_suspect_price` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `comparison_products` ADD `state_fingerprint` varchar(64);--> statement-breakpoint
ALTER TABLE `comparison_products` ADD `last_checked_at` timestamp DEFAULT (now()) NOT NULL;--> statement-breakpoint
CREATE INDEX `match_negative_features_platform_frequency_idx` ON `match_negative_features` (`platform`,`rejection_count`,`last_rejected_at`);--> statement-breakpoint
CREATE INDEX `comparison_history_product_recorded_idx` ON `comparison_price_history` (`source_key`,`created_at`);--> statement-breakpoint
CREATE INDEX `comparison_products_platform_fingerprint_idx` ON `comparison_products` (`platform`,`state_fingerprint`);