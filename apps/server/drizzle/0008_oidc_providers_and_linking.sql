ALTER TABLE `oidc_handoffs` ADD `link_issuer` text;--> statement-breakpoint
ALTER TABLE `oidc_handoffs` ADD `link_subject` text;--> statement-breakpoint
ALTER TABLE `oidc_handoffs` ADD `link_session_hash` text;--> statement-breakpoint
ALTER TABLE `oidc_transactions` ADD `provider` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `oidc_transactions` ADD `link_user_id` text;--> statement-breakpoint
ALTER TABLE `oidc_transactions` ADD `link_session_hash` text;