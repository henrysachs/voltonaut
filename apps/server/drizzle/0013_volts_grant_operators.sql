CREATE TABLE `volts_grant_operators` (
	`entry_id` text PRIMARY KEY NOT NULL,
	`operator_user_id` text,
	`provenance` text NOT NULL,
	`recorded_at` integer NOT NULL,
	FOREIGN KEY (`entry_id`) REFERENCES `volts_ledger`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`operator_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "volts_grant_operators_provenance" CHECK(("volts_grant_operators"."provenance" = 'recorded' AND "volts_grant_operators"."operator_user_id" IS NOT NULL) OR ("volts_grant_operators"."provenance" = 'unknown_before_audit' AND "volts_grant_operators"."operator_user_id" IS NULL))
);
--> statement-breakpoint
CREATE INDEX `volts_grant_operators_operator_idx` ON `volts_grant_operators` (`operator_user_id`);--> statement-breakpoint
-- Grants booked before the audit existed are marked as such; no operator is invented for them.
INSERT INTO `volts_grant_operators` (`entry_id`, `operator_user_id`, `provenance`, `recorded_at`)
SELECT `id`, NULL, 'unknown_before_audit', `created_at` FROM `volts_ledger` WHERE `reason` = 'operator_grant';
--> statement-breakpoint
CREATE TRIGGER `volts_grant_operators_reject_deleted_operator_insert` BEFORE INSERT ON `volts_grant_operators`
WHEN NEW.`operator_user_id` IS NOT NULL AND EXISTS (SELECT 1 FROM `users` WHERE `users`.`id` = NEW.`operator_user_id` AND `users`.`deleted_at` IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'operator account is deleted'); END;
--> statement-breakpoint
CREATE TRIGGER `volts_grant_operators_immutable` BEFORE UPDATE ON `volts_grant_operators`
BEGIN SELECT RAISE(ABORT, 'operator audit is immutable'); END;
