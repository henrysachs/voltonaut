PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_volts_ledger` (
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
	CONSTRAINT "volts_ledger_safe_delta" CHECK(typeof("__new_volts_ledger"."delta_volts") = 'integer' AND "__new_volts_ledger"."delta_volts" BETWEEN -9007199254740991 AND 9007199254740991),
	CONSTRAINT "volts_ledger_reason" CHECK("__new_volts_ledger"."reason" IN ('ride_reward', 'purchase', 'operator_grant')),
	CONSTRAINT "volts_ledger_ride_reward" CHECK("__new_volts_ledger"."reason" <> 'ride_reward' OR ("__new_volts_ledger"."reward_day" IS NOT NULL AND "__new_volts_ledger"."start_tick" IS NOT NULL AND "__new_volts_ledger"."end_tick" IS NOT NULL AND "__new_volts_ledger"."candidate_volts" IS NOT NULL AND "__new_volts_ledger"."cumulative_work_volts" IS NOT NULL AND "__new_volts_ledger"."cumulative_climb_volts" IS NOT NULL AND "__new_volts_ledger"."cumulative_facts_json" IS NOT NULL AND "__new_volts_ledger"."delta_volts" >= 0)),
	CONSTRAINT "volts_ledger_purchase" CHECK("__new_volts_ledger"."reason" <> 'purchase' OR ("__new_volts_ledger"."reward_day" IS NULL AND "__new_volts_ledger"."start_tick" IS NULL AND "__new_volts_ledger"."end_tick" IS NULL AND "__new_volts_ledger"."candidate_volts" IS NULL AND "__new_volts_ledger"."cumulative_work_volts" IS NULL AND "__new_volts_ledger"."cumulative_climb_volts" IS NULL AND "__new_volts_ledger"."cumulative_facts_json" IS NULL AND "__new_volts_ledger"."delta_volts" < 0)),
	CONSTRAINT "volts_ledger_operator_grant" CHECK("__new_volts_ledger"."reason" <> 'operator_grant' OR ("__new_volts_ledger"."reward_day" IS NULL AND "__new_volts_ledger"."start_tick" IS NULL AND "__new_volts_ledger"."end_tick" IS NULL AND "__new_volts_ledger"."candidate_volts" IS NULL AND "__new_volts_ledger"."cumulative_work_volts" IS NULL AND "__new_volts_ledger"."cumulative_climb_volts" IS NULL AND "__new_volts_ledger"."cumulative_facts_json" IS NULL AND "__new_volts_ledger"."delta_volts" > 0)),
	CONSTRAINT "volts_ledger_ticks" CHECK(("__new_volts_ledger"."start_tick" IS NULL AND "__new_volts_ledger"."end_tick" IS NULL) OR (typeof("__new_volts_ledger"."start_tick") = 'integer' AND "__new_volts_ledger"."start_tick" BETWEEN 0 AND 9007199254740991 AND typeof("__new_volts_ledger"."end_tick") = 'integer' AND "__new_volts_ledger"."end_tick" BETWEEN 0 AND 9007199254740991 AND "__new_volts_ledger"."end_tick" > "__new_volts_ledger"."start_tick")),
	CONSTRAINT "volts_ledger_candidate_volts" CHECK("__new_volts_ledger"."candidate_volts" IS NULL OR (typeof("__new_volts_ledger"."candidate_volts") = 'integer' AND "__new_volts_ledger"."candidate_volts" BETWEEN 0 AND 9007199254740991)),
	CONSTRAINT "volts_ledger_cumulative_volts" CHECK(("__new_volts_ledger"."cumulative_work_volts" IS NULL AND "__new_volts_ledger"."cumulative_climb_volts" IS NULL) OR (typeof("__new_volts_ledger"."cumulative_work_volts") = 'integer' AND "__new_volts_ledger"."cumulative_work_volts" BETWEEN 0 AND 9007199254740991 AND typeof("__new_volts_ledger"."cumulative_climb_volts") = 'integer' AND "__new_volts_ledger"."cumulative_climb_volts" BETWEEN 0 AND 9007199254740991))
);
--> statement-breakpoint
INSERT INTO `__new_volts_ledger`("id", "user_id", "delta_volts", "reason", "ref_id", "idempotency_key", "payload_hash", "reward_day", "start_tick", "end_tick", "candidate_volts", "cumulative_work_volts", "cumulative_climb_volts", "cumulative_facts_json", "created_at") SELECT "id", "user_id", "delta_volts", "reason", "ref_id", "idempotency_key", "payload_hash", "reward_day", "start_tick", "end_tick", "candidate_volts", "cumulative_work_volts", "cumulative_climb_volts", "cumulative_facts_json", "created_at" FROM `volts_ledger`;--> statement-breakpoint
DROP TABLE `volts_ledger`;--> statement-breakpoint
ALTER TABLE `__new_volts_ledger` RENAME TO `volts_ledger`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `volts_ledger_owner_idempotency_unique` ON `volts_ledger` (`user_id`,`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `volts_ledger_ride_start_unique` ON `volts_ledger` (`ref_id`,`start_tick`) WHERE "volts_ledger"."reason" = 'ride_reward';--> statement-breakpoint
CREATE UNIQUE INDEX `volts_ledger_ride_end_unique` ON `volts_ledger` (`ref_id`,`end_tick`) WHERE "volts_ledger"."reason" = 'ride_reward';--> statement-breakpoint
CREATE INDEX `volts_ledger_owner_day_reason_idx` ON `volts_ledger` (`user_id`,`reward_day`,`reason`);--> statement-breakpoint
CREATE INDEX `volts_ledger_owner_created_id_idx` ON `volts_ledger` (`user_id`,`created_at`,`id`);