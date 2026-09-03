ALTER TABLE `review_api_degradation_alerts` ADD `resolution_note` text;--> statement-breakpoint
ALTER TABLE `review_api_degradation_alerts` ADD `resolved_by_user_id` int;--> statement-breakpoint
ALTER TABLE `review_api_degradation_alerts` ADD `resolved_at` timestamp;--> statement-breakpoint
CREATE INDEX `review_api_degradation_alerts_resolved_at_idx` ON `review_api_degradation_alerts` (`resolved_at`);