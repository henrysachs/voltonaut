ALTER TABLE strava_transactions ADD COLUMN channel text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE strava_connections ADD COLUMN generation text NOT NULL DEFAULT '';
--> statement-breakpoint
UPDATE strava_connections SET generation = lower(hex(randomblob(16)));
--> statement-breakpoint
ALTER TABLE strava_connections ADD COLUMN token_revision integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE strava_connections ADD COLUMN credential_state text NOT NULL DEFAULT 'available' CONSTRAINT strava_credential_state CHECK (credential_state IN ('available','refreshing','uncertain','reauthorization_required'));
--> statement-breakpoint
ALTER TABLE strava_connections ADD COLUMN work_owner text;
--> statement-breakpoint
ALTER TABLE strava_connections ADD COLUMN work_kind text CONSTRAINT strava_work_kind CHECK (work_kind IN ('refresh','submit','poll','revoke'));
--> statement-breakpoint
ALTER TABLE strava_connections ADD COLUMN work_until integer NOT NULL DEFAULT 0;
--> statement-breakpoint
CREATE TABLE strava_deliveries (
  delivery_id text PRIMARY KEY NOT NULL,
  user_id text NOT NULL REFERENCES users(id),
  ride_id text NOT NULL,
  authority text NOT NULL CONSTRAINT strava_delivery_authority_kind CHECK (json_valid(authority) AND COALESCE(json_extract(authority,'$.kind') IN ('consented','stopped'),0)),
  progress text NOT NULL CONSTRAINT strava_delivery_progress_kind CHECK (json_valid(progress) AND COALESCE(json_extract(progress,'$.kind') IN ('queued','preparing','submitting','submission_unknown','processing','delivered','submission_rejected','processing_rejected'),0)),
  CONSTRAINT strava_delivery_own_ride CHECK (COALESCE(json_extract(authority,'$.consent.rideId') = ride_id AND json_type(authority,'$.consent') = 'object',0)),
  CONSTRAINT strava_delivery_authority_state CHECK (COALESCE(CASE json_extract(authority,'$.kind')
    WHEN 'consented' THEN json_type(authority,'$.consentedAtMs') = 'integer'
    WHEN 'stopped' THEN json_type(authority,'$.stoppedAtMs') = 'integer' AND json_extract(authority,'$.reason') IN ('disconnect','credentials','policy')
  END,0)),
  CONSTRAINT strava_delivery_progress_state CHECK (COALESCE(CASE json_extract(progress,'$.kind')
    WHEN 'queued' THEN json_type(progress,'$.notBeforeMs') = 'integer'
    WHEN 'preparing' THEN json_type(progress,'$.owner') = 'text' AND json_type(progress,'$.leaseUntilMs') = 'integer'
    WHEN 'submitting' THEN json_type(progress,'$.attemptId') = 'text' AND json_type(progress,'$.startedAtMs') = 'integer' AND json_type(progress,'$.leaseUntilMs') = 'integer'
    WHEN 'submission_unknown' THEN json_type(progress,'$.attemptId') = 'text' AND json_extract(progress,'$.reason') IN ('response_lost','crash','protocol')
    WHEN 'processing' THEN json_type(progress,'$.nextPollAtMs') = 'integer' AND json_extract(progress,'$.issue') IN ('none','authorization','rate_limit','network','protocol')
    WHEN 'delivered' THEN json_type(progress,'$.activityId') = 'text' AND json_type(progress,'$.confirmedAtMs') = 'integer'
    WHEN 'submission_rejected' THEN json_extract(progress,'$.reason') IN ('authorization','rate_limit','file','provider')
    WHEN 'processing_rejected' THEN json_extract(progress,'$.reason') = 'provider_error'
  END,0)),
  CONSTRAINT strava_delivery_receipt CHECK (CASE WHEN json_extract(progress,'$.kind') IN ('processing','delivered','processing_rejected') THEN COALESCE(json_type(progress,'$.receipt.uploadId') = 'text' AND json_type(progress,'$.receipt.externalId') = 'text',0) ELSE 1 END)
);
--> statement-breakpoint
CREATE UNIQUE INDEX strava_deliveries_owner_ride ON strava_deliveries(user_id,ride_id);
--> statement-breakpoint
CREATE TABLE strava_rate_budget (
  id integer PRIMARY KEY CONSTRAINT strava_rate_singleton CHECK(id=1),
  short_reset integer NOT NULL,
  day_reset integer NOT NULL,
  short_limit integer NOT NULL DEFAULT 1,
  day_limit integer NOT NULL DEFAULT 1,
  read_short_limit integer NOT NULL DEFAULT 1,
  read_day_limit integer NOT NULL DEFAULT 1,
  short_usage integer NOT NULL DEFAULT 0,
  day_usage integer NOT NULL DEFAULT 0,
  read_short_usage integer NOT NULL DEFAULT 0,
  read_day_usage integer NOT NULL DEFAULT 0,
  short_pending integer NOT NULL DEFAULT 0,
  day_pending integer NOT NULL DEFAULT 0,
  read_short_pending integer NOT NULL DEFAULT 0,
  read_day_pending integer NOT NULL DEFAULT 0,
  blocked_until integer NOT NULL DEFAULT 0
);
