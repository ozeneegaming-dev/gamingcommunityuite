"use server";

import { NOTIFICATIONS_ACP_SECTION, type GcsNotificationPrefs, type GcsResult } from "@gcs/core";
import { field, intField, runAcpAction } from "@/lib/acp-actions";
import { services } from "@/lib/services";

const EMAILS = ["OFF", "INSTANT", "DIGEST"] as const;

/** Valorile implicite ale notificărilor (un rând pe tip) și ora digestului. */
export async function saveNotificationDefaults(fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(NOTIFICATIONS_ACP_SECTION, "edit", async (actor) => {
    const { notifications, registry, settings } = services();
    const prefs: GcsNotificationPrefs = {};
    for (const def of registry.notificationTypes()) {
      const email = field(fd, `email:${def.key}`);
      prefs[def.key] = { site: fd.get(`site:${def.key}`) === "on", email: (EMAILS as readonly string[]).includes(email) ? (email as (typeof EMAILS)[number]) : def.defaultEmail };
    }
    await notifications.setDefaults(actor, prefs);
    await settings.set("notifications.digest_hour", intField(fd, "digestHour"), actor);
    return null;
  });
}
