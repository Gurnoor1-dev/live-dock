import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Small app-owned settings store.
 * Infinite Flight remains the source of truth for live organisation, fleet,
 * member, schedule and flight data; those API payloads are not mirrored here.
 */
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<Record<string, unknown>>().notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});

export const schema = { appSettings };
