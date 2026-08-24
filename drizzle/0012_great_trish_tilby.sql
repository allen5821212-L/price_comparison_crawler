CREATE TABLE `match_review_skips` (
	`id` int AUTO_INCREMENT NOT NULL,
	`source_key` varchar(128) NOT NULL,
	`fingerprint` varchar(64) NOT NULL,
	`created_by_open_id` varchar(64) NOT NULL,
	`note` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `match_review_skips_id` PRIMARY KEY(`id`),
	CONSTRAINT `match_review_skips_source_fingerprint_unique` UNIQUE(`source_key`,`fingerprint`)
);
--> statement-breakpoint
CREATE INDEX `match_review_skips_fingerprint_idx` ON `match_review_skips` (`fingerprint`);