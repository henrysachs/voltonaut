CREATE TABLE `auth_identities` (
	`issuer` text NOT NULL,
	`subject` text NOT NULL,
	`user_id` text NOT NULL,
	PRIMARY KEY(`issuer`, `subject`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `oidc_handoffs` (
	`code_hash` text PRIMARY KEY NOT NULL,
	`binding_hash` text NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `oidc_handoffs_expiry` ON `oidc_handoffs` (`expires_at`);--> statement-breakpoint
CREATE TABLE `oidc_transactions` (
	`state_hash` text PRIMARY KEY NOT NULL,
	`binding_hash` text NOT NULL,
	`nonce` text NOT NULL,
	`verifier` text NOT NULL,
	`expires_at` integer NOT NULL,
	`claimed_at` integer
);
--> statement-breakpoint
CREATE INDEX `oidc_transactions_expiry` ON `oidc_transactions` (`expires_at`);
