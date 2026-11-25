CREATE TABLE `progress_consents` (
	`user_id` text PRIMARY KEY NOT NULL,
	`version` integer NOT NULL,
	`enabled` integer NOT NULL,
	`session_hash` text NOT NULL,
	`session_generation` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "progress_consents_version" CHECK(typeof("progress_consents"."version") = 'integer' AND "progress_consents"."version" BETWEEN 0 AND 9007199254740991),
	CONSTRAINT "progress_consents_enabled" CHECK(typeof("progress_consents"."enabled") = 'integer' AND "progress_consents"."enabled" IN (0, 1)),
	CONSTRAINT "progress_consents_session_hash" CHECK(length("progress_consents"."session_hash") > 0),
	CONSTRAINT "progress_consents_session_generation" CHECK(typeof("progress_consents"."session_generation") = 'integer' AND "progress_consents"."session_generation" BETWEEN 1 AND 9007199254740991),
	CONSTRAINT "progress_consents_updated_at" CHECK(typeof("progress_consents"."updated_at") = 'integer' AND "progress_consents"."updated_at" BETWEEN 0 AND 9007199254740991)
);
--> statement-breakpoint
CREATE TABLE `ride_progress_journals` (
	`journal_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`session_hash` text NOT NULL,
	`session_generation` integer NOT NULL,
	`consent_version` integer NOT NULL,
	`source` text NOT NULL,
	`clock_scale` real NOT NULL,
	`physics_revision` text NOT NULL,
	`route_id` text NOT NULL,
	`route_revision` text NOT NULL,
	`physics_json` text NOT NULL,
	`started_at_ms` integer NOT NULL,
	`last_end_tick` integer NOT NULL,
	`last_sequence` integer NOT NULL,
	`last_ended_at_ms` integer NOT NULL,
	`last_reward_day` text NOT NULL,
	`cumulative_facts_json` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ride_progress_journals_journal_id" CHECK(length("ride_progress_journals"."journal_id") > 0),
	CONSTRAINT "ride_progress_journals_session_hash" CHECK(length("ride_progress_journals"."session_hash") > 0),
	CONSTRAINT "ride_progress_journals_session_generation" CHECK(typeof("ride_progress_journals"."session_generation") = 'integer' AND "ride_progress_journals"."session_generation" BETWEEN 1 AND 9007199254740991),
	CONSTRAINT "ride_progress_journals_consent_version" CHECK(typeof("ride_progress_journals"."consent_version") = 'integer' AND "ride_progress_journals"."consent_version" > 0),
	CONSTRAINT "ride_progress_journals_source" CHECK("ride_progress_journals"."source" = 'ble'),
	CONSTRAINT "ride_progress_journals_clock_scale" CHECK(typeof("ride_progress_journals"."clock_scale") = 'real' AND "ride_progress_journals"."clock_scale" = 1),
	CONSTRAINT "ride_progress_journals_physics_revision" CHECK(length("ride_progress_journals"."physics_revision") > 0),
	CONSTRAINT "ride_progress_journals_route_id" CHECK(length("ride_progress_journals"."route_id") > 0),
	CONSTRAINT "ride_progress_journals_route_revision" CHECK(length("ride_progress_journals"."route_revision") > 0),
	CONSTRAINT "ride_progress_journals_physics_json" CHECK(length("ride_progress_journals"."physics_json") > 0 AND json_valid("ride_progress_journals"."physics_json")),
	CONSTRAINT "ride_progress_journals_ticks" CHECK(typeof("ride_progress_journals"."last_end_tick") = 'integer' AND "ride_progress_journals"."last_end_tick" BETWEEN 0 AND 9007199254740991),
	CONSTRAINT "ride_progress_journals_last_sequence" CHECK(typeof("ride_progress_journals"."last_sequence") = 'integer' AND "ride_progress_journals"."last_sequence" BETWEEN 0 AND 9007199254740991 AND "ride_progress_journals"."last_sequence" < "ride_progress_journals"."last_end_tick"),
	CONSTRAINT "ride_progress_journals_timeline" CHECK(typeof("ride_progress_journals"."started_at_ms") = 'integer' AND "ride_progress_journals"."started_at_ms" BETWEEN 0 AND 9007199254740991 AND typeof("ride_progress_journals"."last_ended_at_ms") = 'integer' AND "ride_progress_journals"."last_ended_at_ms" BETWEEN "ride_progress_journals"."started_at_ms" AND 9007199254740991 AND "ride_progress_journals"."last_reward_day" = date("ride_progress_journals"."last_ended_at_ms" / 1000, 'unixepoch')),
	CONSTRAINT "ride_progress_journals_cumulative_facts_json" CHECK(length("ride_progress_journals"."cumulative_facts_json") > 0 AND json_valid("ride_progress_journals"."cumulative_facts_json")),
	CONSTRAINT "ride_progress_journals_created_at" CHECK(typeof("ride_progress_journals"."created_at") = 'integer' AND "ride_progress_journals"."created_at" BETWEEN 0 AND 9007199254740991)
);
--> statement-breakpoint
CREATE INDEX `ride_progress_journals_owner_created_id_idx` ON `ride_progress_journals` (`user_id`,`created_at`,`journal_id`);--> statement-breakpoint
CREATE INDEX `ride_progress_journals_owner_session_idx` ON `ride_progress_journals` (`user_id`,`session_hash`);--> statement-breakpoint
CREATE TABLE `ride_progress_ranges` (
	`id` text PRIMARY KEY NOT NULL,
	`journal_id` text NOT NULL,
	`user_id` text NOT NULL,
	`start_tick` integer NOT NULL,
	`end_tick` integer NOT NULL,
	`payload_hash` text NOT NULL,
	`payload_json` text NOT NULL,
	`cumulative_facts_json` text NOT NULL,
	`receipt_json` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ride_progress_ranges_id" CHECK(length("ride_progress_ranges"."id") > 0),
	CONSTRAINT "ride_progress_ranges_journal_id" CHECK(length("ride_progress_ranges"."journal_id") > 0),
	CONSTRAINT "ride_progress_ranges_ticks" CHECK(typeof("ride_progress_ranges"."start_tick") = 'integer' AND "ride_progress_ranges"."start_tick" BETWEEN 0 AND 9007199254740991 AND typeof("ride_progress_ranges"."end_tick") = 'integer' AND "ride_progress_ranges"."end_tick" BETWEEN 1 AND 9007199254740991 AND "ride_progress_ranges"."end_tick" > "ride_progress_ranges"."start_tick"),
	CONSTRAINT "ride_progress_ranges_payload_hash" CHECK(length("ride_progress_ranges"."payload_hash") = 64 AND "ride_progress_ranges"."payload_hash" NOT GLOB '*[^0-9a-f]*'),
	CONSTRAINT "ride_progress_ranges_payload_json" CHECK(length("ride_progress_ranges"."payload_json") > 0 AND json_valid("ride_progress_ranges"."payload_json")),
	CONSTRAINT "ride_progress_ranges_cumulative_facts_json" CHECK(length("ride_progress_ranges"."cumulative_facts_json") > 0 AND json_valid("ride_progress_ranges"."cumulative_facts_json")),
	CONSTRAINT "ride_progress_ranges_receipt_json" CHECK(length("ride_progress_ranges"."receipt_json") > 0 AND json_valid("ride_progress_ranges"."receipt_json")),
	CONSTRAINT "ride_progress_ranges_created_at" CHECK(typeof("ride_progress_ranges"."created_at") = 'integer' AND "ride_progress_ranges"."created_at" BETWEEN 0 AND 9007199254740991)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ride_progress_ranges_journal_start_unique` ON `ride_progress_ranges` (`journal_id`,`start_tick`);--> statement-breakpoint
CREATE UNIQUE INDEX `ride_progress_ranges_journal_end_unique` ON `ride_progress_ranges` (`journal_id`,`end_tick`);--> statement-breakpoint
CREATE INDEX `ride_progress_ranges_owner_created_id_idx` ON `ride_progress_ranges` (`user_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `ride_progress_ranges_owner_journal_idx` ON `ride_progress_ranges` (`user_id`,`journal_id`,`start_tick`);--> statement-breakpoint
CREATE TRIGGER `progress_consents_reject_deleted_owner_insert` BEFORE INSERT ON `progress_consents`
WHEN EXISTS (SELECT 1 FROM `users` WHERE `users`.`id` = NEW.`user_id` AND `users`.`deleted_at` IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'account is deleted'); END;
--> statement-breakpoint
CREATE TRIGGER `progress_consents_reject_deleted_owner_update` BEFORE UPDATE ON `progress_consents`
WHEN EXISTS (SELECT 1 FROM `users` WHERE `users`.`id` = NEW.`user_id` AND `users`.`deleted_at` IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'account is deleted'); END;
--> statement-breakpoint
CREATE TRIGGER `ride_progress_journals_reject_deleted_owner_insert` BEFORE INSERT ON `ride_progress_journals`
WHEN EXISTS (SELECT 1 FROM `users` WHERE `users`.`id` = NEW.`user_id` AND `users`.`deleted_at` IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'account is deleted'); END;
--> statement-breakpoint
CREATE TRIGGER `ride_progress_journals_reject_deleted_owner_update` BEFORE UPDATE ON `ride_progress_journals`
WHEN EXISTS (SELECT 1 FROM `users` WHERE `users`.`id` = NEW.`user_id` AND `users`.`deleted_at` IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'account is deleted'); END;
--> statement-breakpoint
CREATE TRIGGER `ride_progress_ranges_reject_deleted_owner_insert` BEFORE INSERT ON `ride_progress_ranges`
WHEN EXISTS (SELECT 1 FROM `users` WHERE `users`.`id` = NEW.`user_id` AND `users`.`deleted_at` IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'account is deleted'); END;
--> statement-breakpoint
CREATE TRIGGER `ride_progress_ranges_reject_deleted_owner_update` BEFORE UPDATE ON `ride_progress_ranges`
WHEN EXISTS (SELECT 1 FROM `users` WHERE `users`.`id` = NEW.`user_id` AND `users`.`deleted_at` IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'account is deleted'); END;