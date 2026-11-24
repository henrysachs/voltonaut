CREATE TABLE `volts_ledger` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`delta_volts` integer NOT NULL,
	`reason` text NOT NULL,
	`ref_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`payload_hash` text NOT NULL,
	`reward_day` text,
	`start_tick` integer,
	`end_tick` integer,
	`candidate_volts` integer,
	`cumulative_work_volts` integer,
	`cumulative_climb_volts` integer,
	`cumulative_facts_json` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "volts_ledger_safe_delta" CHECK(typeof("volts_ledger"."delta_volts") = 'integer' AND "volts_ledger"."delta_volts" BETWEEN -9007199254740991 AND 9007199254740991),
	CONSTRAINT "volts_ledger_reason" CHECK("volts_ledger"."reason" IN ('ride_reward', 'purchase')),
	CONSTRAINT "volts_ledger_ride_reward" CHECK("volts_ledger"."reason" <> 'ride_reward' OR ("volts_ledger"."reward_day" IS NOT NULL AND "volts_ledger"."start_tick" IS NOT NULL AND "volts_ledger"."end_tick" IS NOT NULL AND "volts_ledger"."candidate_volts" IS NOT NULL AND "volts_ledger"."cumulative_work_volts" IS NOT NULL AND "volts_ledger"."cumulative_climb_volts" IS NOT NULL AND "volts_ledger"."cumulative_facts_json" IS NOT NULL AND "volts_ledger"."delta_volts" >= 0)),
	CONSTRAINT "volts_ledger_purchase" CHECK("volts_ledger"."reason" <> 'purchase' OR ("volts_ledger"."reward_day" IS NULL AND "volts_ledger"."start_tick" IS NULL AND "volts_ledger"."end_tick" IS NULL AND "volts_ledger"."candidate_volts" IS NULL AND "volts_ledger"."cumulative_work_volts" IS NULL AND "volts_ledger"."cumulative_climb_volts" IS NULL AND "volts_ledger"."cumulative_facts_json" IS NULL AND "volts_ledger"."delta_volts" < 0)),
	CONSTRAINT "volts_ledger_ticks" CHECK(("volts_ledger"."start_tick" IS NULL AND "volts_ledger"."end_tick" IS NULL) OR (typeof("volts_ledger"."start_tick") = 'integer' AND "volts_ledger"."start_tick" BETWEEN 0 AND 9007199254740991 AND typeof("volts_ledger"."end_tick") = 'integer' AND "volts_ledger"."end_tick" BETWEEN 0 AND 9007199254740991 AND "volts_ledger"."end_tick" > "volts_ledger"."start_tick")),
	CONSTRAINT "volts_ledger_candidate_volts" CHECK("volts_ledger"."candidate_volts" IS NULL OR (typeof("volts_ledger"."candidate_volts") = 'integer' AND "volts_ledger"."candidate_volts" BETWEEN 0 AND 9007199254740991)),
	CONSTRAINT "volts_ledger_cumulative_volts" CHECK(("volts_ledger"."cumulative_work_volts" IS NULL AND "volts_ledger"."cumulative_climb_volts" IS NULL) OR (typeof("volts_ledger"."cumulative_work_volts") = 'integer' AND "volts_ledger"."cumulative_work_volts" BETWEEN 0 AND 9007199254740991 AND typeof("volts_ledger"."cumulative_climb_volts") = 'integer' AND "volts_ledger"."cumulative_climb_volts" BETWEEN 0 AND 9007199254740991))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `volts_ledger_owner_idempotency_unique` ON `volts_ledger` (`user_id`,`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `volts_ledger_ride_start_unique` ON `volts_ledger` (`ref_id`,`start_tick`) WHERE "volts_ledger"."reason" = 'ride_reward';--> statement-breakpoint
CREATE UNIQUE INDEX `volts_ledger_ride_end_unique` ON `volts_ledger` (`ref_id`,`end_tick`) WHERE "volts_ledger"."reason" = 'ride_reward';--> statement-breakpoint
CREATE INDEX `volts_ledger_owner_day_reason_idx` ON `volts_ledger` (`user_id`,`reward_day`,`reason`);--> statement-breakpoint
CREATE INDEX `volts_ledger_owner_created_id_idx` ON `volts_ledger` (`user_id`,`created_at`,`id`);