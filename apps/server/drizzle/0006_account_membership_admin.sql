CREATE TABLE `account_status` (
	`user_id` text PRIMARY KEY NOT NULL,
	`tier` text DEFAULT 'normal' NOT NULL,
	`vip` integer DEFAULT false NOT NULL,
	`role` text DEFAULT 'user' NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "account_status_tier" CHECK("account_status"."tier" IN ('normal', 'premium', 'pro')),
	CONSTRAINT "account_status_vip" CHECK("account_status"."vip" IN (0, 1)),
	CONSTRAINT "account_status_role" CHECK("account_status"."role" IN ('user', 'admin'))
);
