CREATE TABLE `avatar_loadouts` (
	`user_id` text PRIMARY KEY NOT NULL,
	`loadout_json` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "avatar_loadouts_json" CHECK(json_valid("avatar_loadouts"."loadout_json")),
	CONSTRAINT "avatar_loadouts_updated_at" CHECK(typeof("avatar_loadouts"."updated_at") = 'integer' AND "avatar_loadouts"."updated_at" >= 0)
);
--> statement-breakpoint
CREATE TRIGGER `avatar_loadouts_reject_deleted_owner_insert` BEFORE INSERT ON `avatar_loadouts`
WHEN EXISTS (SELECT 1 FROM `users` WHERE `users`.`id` = NEW.`user_id` AND `users`.`deleted_at` IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'account is deleted'); END;
--> statement-breakpoint
CREATE TRIGGER `avatar_loadouts_reject_deleted_owner_update` BEFORE UPDATE ON `avatar_loadouts`
WHEN EXISTS (SELECT 1 FROM `users` WHERE `users`.`id` = NEW.`user_id` AND `users`.`deleted_at` IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'account is deleted'); END;
