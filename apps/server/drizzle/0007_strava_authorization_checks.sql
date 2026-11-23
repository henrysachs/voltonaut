ALTER TABLE `strava_connections` ADD `authorization_hint_revision` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `strava_connections` ADD `authorization_checked_revision` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `strava_connections` ADD `authorization_check_after` integer DEFAULT 0 NOT NULL;