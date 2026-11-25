CREATE TABLE `inventory` (
	`user_id` text NOT NULL,
	`item_id` text NOT NULL,
	`source` text NOT NULL,
	`purchase_request_id` text,
	`acquired_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `item_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "inventory_source" CHECK("inventory"."source" IN ('shop')),
	CONSTRAINT "inventory_shop_request" CHECK("inventory"."source" <> 'shop' OR "inventory"."purchase_request_id" IS NOT NULL),
	CONSTRAINT "inventory_acquired_at" CHECK(typeof("inventory"."acquired_at") = 'integer' AND "inventory"."acquired_at" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inventory_owner_purchase_request_unique` ON `inventory` (`user_id`,`purchase_request_id`);