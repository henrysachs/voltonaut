CREATE TABLE `profiles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`profile_json` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `rides` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`payload_json` text NOT NULL,
	`payload_hash` text NOT NULL,
	`receipt_json` text NOT NULL,
	`assessment_json` text NOT NULL,
	`started_at` text NOT NULL,
	`uploaded_at` integer NOT NULL,
	`duration_ms` integer NOT NULL,
	`distance_m` real NOT NULL,
	`source` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `rides_owner_id_idx` ON `rides` (`user_id`,`id`);