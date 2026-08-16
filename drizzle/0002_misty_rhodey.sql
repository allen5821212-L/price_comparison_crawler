ALTER TABLE `matching_feedback` ADD `hit_count` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `matching_feedback` ADD `last_hit_at` timestamp;