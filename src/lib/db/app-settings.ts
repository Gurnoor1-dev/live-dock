import "server-only";

import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { appSettings } from "@/lib/db/schema";

/** Read one app-owned setting. Live Infinite Flight data must remain in the IF API. */
export async function getAppSetting<T extends Record<string, unknown> = Record<string, unknown>>(key: string): Promise<T | null> {
  const [row] = await getDb().select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, key)).limit(1);
  return (row?.value as T | undefined) ?? null;
}

/** Create or replace one app-owned setting atomically. */
export async function setAppSetting<T extends Record<string, unknown>>(key: string, value: T): Promise<void> {
  await getDb().insert(appSettings).values({ key, value, updatedAt: new Date() }).onConflictDoUpdate({
    target: appSettings.key,
    set: { value, updatedAt: new Date() }
  });
}

/** Remove one app-owned setting. */
export async function deleteAppSetting(key: string): Promise<void> {
  await getDb().delete(appSettings).where(eq(appSettings.key, key));
}
