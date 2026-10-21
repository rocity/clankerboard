import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Db } from "./client";
import { instanceSettings } from "./schema";

/** Returns the stored auth secret, creating one on first boot. */
export async function ensureAuthSecret(db: Db): Promise<string> {
  await db
    .insert(instanceSettings)
    .values({ key: "auth_secret", value: randomBytes(32).toString("base64url") })
    .onConflictDoNothing();
  const [row] = await db
    .select({ value: instanceSettings.value })
    .from(instanceSettings)
    .where(eq(instanceSettings.key, "auth_secret"));
  if (!row) throw new Error("auth secret missing after insert");
  return row.value;
}
