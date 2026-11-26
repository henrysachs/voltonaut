PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_ride_progress_journals` (
	`journal_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`session_hash` text NOT NULL,
	`session_generation` integer NOT NULL,
	`consent_version` integer NOT NULL,
	`source` text NOT NULL,
	`clock_scale` real NOT NULL,
	`physics_revision` text NOT NULL,
	`route_id` text,
	`route_revision` text,
	`world_id` text,
	`world_revision` text,
	`path_id` text,
	`physics_json` text NOT NULL,
	`started_at_ms` integer NOT NULL,
	`last_end_tick` integer NOT NULL,
	`last_sequence` integer NOT NULL,
	`last_ended_at_ms` integer NOT NULL,
	`last_reward_day` text NOT NULL,
	`cumulative_facts_json` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ride_progress_journals_journal_id" CHECK(length("__new_ride_progress_journals"."journal_id") > 0),
	CONSTRAINT "ride_progress_journals_session_hash" CHECK(length("__new_ride_progress_journals"."session_hash") > 0),
	CONSTRAINT "ride_progress_journals_session_generation" CHECK(typeof("__new_ride_progress_journals"."session_generation") = 'integer' AND "__new_ride_progress_journals"."session_generation" BETWEEN 1 AND 9007199254740991),
	CONSTRAINT "ride_progress_journals_consent_version" CHECK(typeof("__new_ride_progress_journals"."consent_version") = 'integer' AND "__new_ride_progress_journals"."consent_version" > 0),
	CONSTRAINT "ride_progress_journals_source" CHECK("__new_ride_progress_journals"."source" = 'ble'),
	CONSTRAINT "ride_progress_journals_clock_scale" CHECK(typeof("__new_ride_progress_journals"."clock_scale") = 'real' AND "__new_ride_progress_journals"."clock_scale" = 1),
	CONSTRAINT "ride_progress_journals_physics_revision" CHECK(length("__new_ride_progress_journals"."physics_revision") > 0),
	CONSTRAINT "ride_progress_journals_route_id" CHECK(length("__new_ride_progress_journals"."route_id") > 0),
	CONSTRAINT "ride_progress_journals_route_revision" CHECK(length("__new_ride_progress_journals"."route_revision") > 0),
	CONSTRAINT "ride_progress_journals_world_id" CHECK(length("__new_ride_progress_journals"."world_id") > 0),
	CONSTRAINT "ride_progress_journals_world_revision" CHECK(length("__new_ride_progress_journals"."world_revision") > 0),
	CONSTRAINT "ride_progress_journals_path_id" CHECK(length("__new_ride_progress_journals"."path_id") > 0),
	CONSTRAINT "ride_progress_journals_ride_reference" CHECK(("__new_ride_progress_journals"."world_id" IS NOT NULL AND "__new_ride_progress_journals"."world_revision" IS NOT NULL AND "__new_ride_progress_journals"."path_id" IS NOT NULL AND "__new_ride_progress_journals"."route_id" IS NULL AND "__new_ride_progress_journals"."route_revision" IS NULL) OR ("__new_ride_progress_journals"."world_id" IS NULL AND "__new_ride_progress_journals"."world_revision" IS NULL AND "__new_ride_progress_journals"."path_id" IS NULL AND "__new_ride_progress_journals"."route_id" IS NOT NULL AND "__new_ride_progress_journals"."route_revision" IS NOT NULL)),
	CONSTRAINT "ride_progress_journals_physics_json" CHECK(length("__new_ride_progress_journals"."physics_json") > 0 AND json_valid("__new_ride_progress_journals"."physics_json")),
	CONSTRAINT "ride_progress_journals_ticks" CHECK(typeof("__new_ride_progress_journals"."last_end_tick") = 'integer' AND "__new_ride_progress_journals"."last_end_tick" BETWEEN 0 AND 9007199254740991),
	CONSTRAINT "ride_progress_journals_last_sequence" CHECK(typeof("__new_ride_progress_journals"."last_sequence") = 'integer' AND "__new_ride_progress_journals"."last_sequence" BETWEEN 0 AND 9007199254740991 AND "__new_ride_progress_journals"."last_sequence" < "__new_ride_progress_journals"."last_end_tick"),
	CONSTRAINT "ride_progress_journals_timeline" CHECK(typeof("__new_ride_progress_journals"."started_at_ms") = 'integer' AND "__new_ride_progress_journals"."started_at_ms" BETWEEN 0 AND 9007199254740991 AND typeof("__new_ride_progress_journals"."last_ended_at_ms") = 'integer' AND "__new_ride_progress_journals"."last_ended_at_ms" BETWEEN "__new_ride_progress_journals"."started_at_ms" AND 9007199254740991 AND "__new_ride_progress_journals"."last_reward_day" = date("__new_ride_progress_journals"."last_ended_at_ms" / 1000, 'unixepoch')),
	CONSTRAINT "ride_progress_journals_cumulative_facts_json" CHECK(length("__new_ride_progress_journals"."cumulative_facts_json") > 0 AND json_valid("__new_ride_progress_journals"."cumulative_facts_json")),
	CONSTRAINT "ride_progress_journals_created_at" CHECK(typeof("__new_ride_progress_journals"."created_at") = 'integer' AND "__new_ride_progress_journals"."created_at" BETWEEN 0 AND 9007199254740991)
);
--> statement-breakpoint
-- Stored journals keep their single-route reference unchanged; no world fields are backfilled.
INSERT INTO `__new_ride_progress_journals`("journal_id", "user_id", "session_hash", "session_generation", "consent_version", "source", "clock_scale", "physics_revision", "route_id", "route_revision", "physics_json", "started_at_ms", "last_end_tick", "last_sequence", "last_ended_at_ms", "last_reward_day", "cumulative_facts_json", "created_at") SELECT "journal_id", "user_id", "session_hash", "session_generation", "consent_version", "source", "clock_scale", "physics_revision", "route_id", "route_revision", "physics_json", "started_at_ms", "last_end_tick", "last_sequence", "last_ended_at_ms", "last_reward_day", "cumulative_facts_json", "created_at" FROM `ride_progress_journals`;--> statement-breakpoint
DROP TABLE `ride_progress_journals`;--> statement-breakpoint
ALTER TABLE `__new_ride_progress_journals` RENAME TO `ride_progress_journals`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `ride_progress_journals_owner_created_id_idx` ON `ride_progress_journals` (`user_id`,`created_at`,`journal_id`);--> statement-breakpoint
CREATE INDEX `ride_progress_journals_owner_session_idx` ON `ride_progress_journals` (`user_id`,`session_hash`);--> statement-breakpoint
-- Rebuilding ride_progress_journals drops its 0012 deletion guards; restore them unchanged.
CREATE TRIGGER `ride_progress_journals_reject_deleted_owner_insert` BEFORE INSERT ON `ride_progress_journals`
WHEN EXISTS (SELECT 1 FROM `users` WHERE `users`.`id` = NEW.`user_id` AND `users`.`deleted_at` IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'account is deleted'); END;
--> statement-breakpoint
CREATE TRIGGER `ride_progress_journals_reject_deleted_owner_update` BEFORE UPDATE ON `ride_progress_journals`
WHEN EXISTS (SELECT 1 FROM `users` WHERE `users`.`id` = NEW.`user_id` AND `users`.`deleted_at` IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'account is deleted'); END;
