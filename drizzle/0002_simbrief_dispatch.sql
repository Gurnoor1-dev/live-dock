CREATE TABLE IF NOT EXISTS "dispatch_briefings" (
 "schedule_id" text PRIMARY KEY NOT NULL,
 "pilot_ifc_user_id" text NOT NULL,
 "ofp_id" text NOT NULL UNIQUE,
 "raw_xml" text NOT NULL,
 "data" jsonb NOT NULL,
 "sync_status" text NOT NULL DEFAULT 'pending',
 "sync_error" text,
 "created_at" timestamptz NOT NULL DEFAULT now(),
 "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "dispatch_briefings_pilot_idx" ON "dispatch_briefings" ("pilot_ifc_user_id");