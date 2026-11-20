CREATE TABLE `strava_connections` (
	`user_id` text PRIMARY KEY NOT NULL,
	`athlete_id` text NOT NULL,
	`status` text NOT NULL,
	`encrypted_tokens` text NOT NULL,
	`access_expires_at` integer NOT NULL,
	`scope` text NOT NULL,
	`revoke_lease_until` integer DEFAULT 0 NOT NULL,
	`handoff_hash` text,
	`binding_hash` text,
	`confirm_by` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "strava_connection_state" CHECK(("strava_connections"."status" = 'pending' AND "strava_connections"."handoff_hash" IS NOT NULL AND "strava_connections"."binding_hash" IS NOT NULL AND "strava_connections"."confirm_by" IS NOT NULL) OR ("strava_connections"."status" IN ('connected', 'revocation_pending') AND "strava_connections"."handoff_hash" IS NULL AND "strava_connections"."binding_hash" IS NULL AND "strava_connections"."confirm_by" IS NULL)),
	CONSTRAINT "strava_connection_scope" CHECK("strava_connections"."scope" = 'activity:write')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `strava_connections_athlete_unique` ON `strava_connections` (`athlete_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `strava_connections_handoff_unique` ON `strava_connections` (`handoff_hash`);--> statement-breakpoint
CREATE TABLE `strava_transactions` (
	`state_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`binding_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`claimed_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `strava_transactions_user_unique` ON `strava_transactions` (`user_id`);