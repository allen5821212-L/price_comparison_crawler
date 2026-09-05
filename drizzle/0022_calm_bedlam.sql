ALTER TABLE `comparison_matches` ADD `reviewable` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `comparison_matches` ADD `review_severity` enum('medium','high','critical');--> statement-breakpoint
ALTER TABLE `comparison_matches` ADD `review_risk_score` int;--> statement-breakpoint
ALTER TABLE `comparison_matches` ADD `review_fingerprint` varchar(64);--> statement-breakpoint
ALTER TABLE `comparison_matches` ADD `review_has_coolpc` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `comparison_matches` ADD `review_has_pchome` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `comparison_matches` ADD `review_has_momo` boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX `comparison_matches_review_queue_idx` ON `comparison_matches` (`run_id`,`reviewable`,`review_severity`,`review_risk_score`,`score`);--> statement-breakpoint
CREATE INDEX `comparison_matches_review_fingerprint_idx` ON `comparison_matches` (`run_id`,`review_fingerprint`);--> statement-breakpoint
UPDATE `comparison_matches` AS `matches`
JOIN (
  SELECT `base`.*, (`has_spec_diff` = 1 OR `score` < 0.86 OR `price_spread` >= 0.5) AS `is_reviewable`,
    GREATEST(IF(`has_spec_diff`, 85, 0), ROUND((1 - LEAST(1, GREATEST(0, `score`))) * 100), IF(`price_spread` >= 0.5, LEAST(90, ROUND(`price_spread` * 100)), 0)) AS `risk_score`
  FROM (
    SELECT `id`, `score`, `has_spec_diff`,
      TRIM(COALESCE(`coolpc_name`, '')) <> '' AS `has_coolpc`,
      TRIM(COALESCE(`pchome_name`, '')) <> '' AS `has_pchome`,
      TRIM(COALESCE(`momo_name`, '')) <> '' AS `has_momo`,
      SHA2(CONCAT(`source_key`, CHAR(31), TRIM(COALESCE(`coolpc_name`, '')), CHAR(31), TRIM(COALESCE(`pchome_name`, '')), CHAR(31), TRIM(COALESCE(`momo_name`, '')), CHAR(31), IF(`has_spec_diff`, 'spec-diff', 'no-spec-diff')), 256) AS `fingerprint`,
      ROUND(CASE WHEN (`sinya_price` > 0) + (`coolpc_price` > 0) + (COALESCE(`pchome_price`, 0) > 0) + (COALESCE(`momo_price`, 0) > 0) >= 2 THEN
        (GREATEST(`sinya_price`, `coolpc_price`, COALESCE(`pchome_price`, 0), COALESCE(`momo_price`, 0)) - LEAST(IF(`sinya_price` > 0, `sinya_price`, 2147483647), IF(`coolpc_price` > 0, `coolpc_price`, 2147483647), IF(COALESCE(`pchome_price`, 0) > 0, `pchome_price`, 2147483647), IF(COALESCE(`momo_price`, 0) > 0, `momo_price`, 2147483647))) /
        NULLIF(LEAST(IF(`sinya_price` > 0, `sinya_price`, 2147483647), IF(`coolpc_price` > 0, `coolpc_price`, 2147483647), IF(COALESCE(`pchome_price`, 0) > 0, `pchome_price`, 2147483647), IF(COALESCE(`momo_price`, 0) > 0, `momo_price`, 2147483647)), 0)
      ELSE 0 END, 3) AS `price_spread`
    FROM `comparison_matches`
    WHERE `run_id` IN (SELECT `id` FROM `comparison_runs` WHERE `status` = 'completed' ORDER BY `finished_at` DESC, `id` DESC LIMIT 30)
  ) AS `base`
) AS `review` ON `review`.`id` = `matches`.`id`
SET `matches`.`review_has_coolpc` = `review`.`has_coolpc`,
  `matches`.`review_has_pchome` = `review`.`has_pchome`,
  `matches`.`review_has_momo` = `review`.`has_momo`,
  `matches`.`review_fingerprint` = `review`.`fingerprint`,
  `matches`.`reviewable` = `review`.`is_reviewable`,
  `matches`.`review_risk_score` = IF(`review`.`is_reviewable`, `review`.`risk_score`, NULL),
  `matches`.`review_severity` = CASE WHEN `review`.`is_reviewable` = 0 THEN NULL WHEN `review`.`risk_score` >= 80 THEN 'critical' WHEN `review`.`risk_score` >= 55 THEN 'high' ELSE 'medium' END;
