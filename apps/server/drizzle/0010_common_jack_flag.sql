CREATE TABLE `auth_identity_tombstones` (
	`identity_hash` text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
ALTER TABLE `users` ADD `deleted_email_hash` text;CREATE UNIQUE INDEX `users_deleted_email_hash_unique` ON `users` (`deleted_email_hash`) WHERE `deleted_email_hash` IS NOT NULL;
--> statement-breakpoint
CREATE TRIGGER `users_reject_deleted_tombstone_update` BEFORE UPDATE ON `users`
WHEN OLD.`deleted_at` IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'deleted account tombstone is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `users_reject_deleted_tombstone_delete` BEFORE DELETE ON `users`
WHEN OLD.`deleted_at` IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'deleted account tombstone is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `profiles_reject_deleted_owner_insert` BEFORE INSERT ON `profiles`
WHEN EXISTS (SELECT 1 FROM `users` WHERE `users`.`id` = NEW.`user_id` AND `users`.`deleted_at` IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'account is deleted'); END;
--> statement-breakpoint
CREATE TRIGGER `profiles_reject_deleted_owner_update` BEFORE UPDATE ON `profiles`
WHEN EXISTS (SELECT 1 FROM `users` WHERE `users`.`id` = NEW.`user_id` AND `users`.`deleted_at` IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'account is deleted'); END;
--> statement-breakpoint
CREATE TRIGGER `account_status_reject_deleted_owner_insert` BEFORE INSERT ON `account_status`
WHEN EXISTS (SELECT 1 FROM `users` WHERE `users`.`id` = NEW.`user_id` AND `users`.`deleted_at` IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'account is deleted'); END;
--> statement-breakpoint
CREATE TRIGGER `account_status_reject_deleted_owner_update` BEFORE UPDATE ON `account_status`
WHEN EXISTS (SELECT 1 FROM `users` WHERE `users`.`id` = NEW.`user_id` AND `users`.`deleted_at` IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'account is deleted'); END;
--> statement-breakpoint
CREATE TRIGGER `rides_reject_deleted_owner_insert` BEFORE INSERT ON `rides`
WHEN EXISTS (SELECT 1 FROM `users` WHERE `users`.`id` = NEW.`user_id` AND `users`.`deleted_at` IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'account is deleted'); END;
--> statement-breakpoint
CREATE TRIGGER `rides_reject_deleted_owner_update` BEFORE UPDATE ON `rides`
WHEN EXISTS (SELECT 1 FROM `users` WHERE `users`.`id` = NEW.`user_id` AND `users`.`deleted_at` IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'account is deleted'); END;
--> statement-breakpoint
CREATE TRIGGER `strava_transactions_reject_deleted_owner_insert` BEFORE INSERT ON `strava_transactions`
WHEN EXISTS (SELECT 1 FROM `users` WHERE `users`.`id` = NEW.`user_id` AND `users`.`deleted_at` IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'account is deleted'); END;
--> statement-breakpoint
CREATE TRIGGER `strava_transactions_reject_deleted_owner_update` BEFORE UPDATE ON `strava_transactions`
WHEN EXISTS (SELECT 1 FROM `users` WHERE `users`.`id` = NEW.`user_id` AND `users`.`deleted_at` IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'account is deleted'); END;
--> statement-breakpoint
CREATE TRIGGER `strava_connections_reject_deleted_owner_insert` BEFORE INSERT ON `strava_connections`
WHEN EXISTS (SELECT 1 FROM `users` WHERE `users`.`id` = NEW.`user_id` AND `users`.`deleted_at` IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'account is deleted'); END;
--> statement-breakpoint
CREATE TRIGGER `strava_connections_reject_deleted_owner_update` BEFORE UPDATE ON `strava_connections`
WHEN EXISTS (SELECT 1 FROM `users` WHERE `users`.`id` = NEW.`user_id` AND `users`.`deleted_at` IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'account is deleted'); END;
--> statement-breakpoint
CREATE TRIGGER `strava_deliveries_reject_deleted_owner_insert` BEFORE INSERT ON `strava_deliveries`
WHEN EXISTS (SELECT 1 FROM `users` WHERE `users`.`id` = NEW.`user_id` AND `users`.`deleted_at` IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'account is deleted'); END;
--> statement-breakpoint
CREATE TRIGGER `strava_deliveries_reject_deleted_owner_update` BEFORE UPDATE ON `strava_deliveries`
WHEN EXISTS (SELECT 1 FROM `users` WHERE `users`.`id` = NEW.`user_id` AND `users`.`deleted_at` IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'account is deleted'); END;
--> statement-breakpoint
CREATE TRIGGER `sessions_reject_deleted_owner_insert` BEFORE INSERT ON `sessions`
WHEN EXISTS (SELECT 1 FROM `users` WHERE `users`.`id` = NEW.`user_id` AND `users`.`deleted_at` IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'account is deleted'); END;
--> statement-breakpoint
CREATE TRIGGER `sessions_reject_deleted_owner_update` BEFORE UPDATE ON `sessions`
WHEN EXISTS (SELECT 1 FROM `users` WHERE `users`.`id` = NEW.`user_id` AND `users`.`deleted_at` IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'account is deleted'); END;
--> statement-breakpoint
CREATE TRIGGER `auth_identities_reject_deleted_owner_insert` BEFORE INSERT ON `auth_identities`
WHEN EXISTS (SELECT 1 FROM `users` WHERE `users`.`id` = NEW.`user_id` AND `users`.`deleted_at` IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'account is deleted'); END;
--> statement-breakpoint
CREATE TRIGGER `auth_identities_reject_deleted_owner_update` BEFORE UPDATE ON `auth_identities`
WHEN EXISTS (SELECT 1 FROM `users` WHERE `users`.`id` = NEW.`user_id` AND `users`.`deleted_at` IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'account is deleted'); END;
--> statement-breakpoint
CREATE TRIGGER `oidc_handoffs_reject_deleted_owner_insert` BEFORE INSERT ON `oidc_handoffs`
WHEN EXISTS (SELECT 1 FROM `users` WHERE `users`.`id` = NEW.`user_id` AND `users`.`deleted_at` IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'account is deleted'); END;
--> statement-breakpoint
CREATE TRIGGER `oidc_handoffs_reject_deleted_owner_update` BEFORE UPDATE ON `oidc_handoffs`
WHEN EXISTS (SELECT 1 FROM `users` WHERE `users`.`id` = NEW.`user_id` AND `users`.`deleted_at` IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'account is deleted'); END;