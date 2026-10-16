"use server";

import {
  GCS_CHANNEL_LOCKS,
  GCS_CHANNEL_STATES,
  GCS_EMAIL_MODES,
  GCS_NOTIFY_CHANNELS,
  NOTIFICATIONS_ACP_SECTION,
  NOTIFICATIONS_PRUNE_DAYS_SETTING,
  NOTIFICATIONS_PRUNE_UNREAD_SETTING,
  GcsValidationError,
  normalizeUsername,
  type GcsNotificationDefaultsInput,
  type GcsResult,
} from "@gcs/core";
import { WEEKLY_DAY_SETTING, WEEKLY_ENABLED_SETTING, WEEKLY_HOUR_SETTING } from "@gcs/modules";
import { field, intField, runAcpAction } from "@/lib/acp-actions";
import { services } from "@/lib/services";

const has = (list: readonly string[], v: string) => list.includes(v);

/**
 * Valorile implicite ale notificărilor (Notificări v2): pe fiecare tip, starea fiecărui canal (`ch:<tip>:<canal>`),
 * blocarea lui (`lock:<tip>:<canal>`: gol, „forced” sau „disabled”) și modul emailului (`mode:<tip>`).
 */
export async function saveNotificationDefaults(fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(NOTIFICATIONS_ACP_SECTION, "edit", async (actor) => {
    const { notifications, registry } = services();
    const input: GcsNotificationDefaultsInput = {};
    for (const def of registry.notificationTypes()) {
      if (!fd.has(`mode:${def.key}`)) continue;
      const channels: Record<string, string> = {};
      const locks: Record<string, string> = {};
      for (const ch of GCS_NOTIFY_CHANNELS) {
        const state = field(fd, `ch:${def.key}:${ch}`);
        if (has(GCS_CHANNEL_STATES, state)) channels[ch] = state;
        const lock = field(fd, `lock:${def.key}:${ch}`);
        if (has(GCS_CHANNEL_LOCKS, lock)) locks[ch] = lock;
      }
      const mode = field(fd, `mode:${def.key}`);
      if (has(GCS_EMAIL_MODES, mode)) channels.emailMode = mode;
      input[def.key] = { channels, locks };
    }
    await notifications.setDefaults(actor, input);
    return null;
  });
}

/** Programul digesturilor: ora digestului zilnic; rezumatul săptămânal (pornit, ziua, ora). */
export async function saveNotificationSchedule(fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(NOTIFICATIONS_ACP_SECTION, "edit", async (actor) => {
    const { settings } = services();
    await settings.set("notifications.digest_hour", intField(fd, "digestHour"), actor);
    await settings.set(WEEKLY_ENABLED_SETTING, fd.get("weeklyEnabled") === "on", actor);
    await settings.set(WEEKLY_DAY_SETTING, intField(fd, "weeklyDay"), actor);
    await settings.set(WEEKLY_HOUR_SETTING, intField(fd, "weeklyHour"), actor);
    return null;
  });
}

/** Curățenia: după câte zile pleacă notificările citite (și, opțional, cele necitite). */
export async function saveNotificationPrune(fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(NOTIFICATIONS_ACP_SECTION, "edit", async (actor) => {
    const { settings } = services();
    await settings.set(NOTIFICATIONS_PRUNE_DAYS_SETTING, intField(fd, "pruneDays"), actor);
    await settings.set(NOTIFICATIONS_PRUNE_UNREAD_SETTING, fd.get("pruneUnread") === "on", actor);
    return null;
  });
}

/** „Resetează la implicit pentru toți membrii”: alegerile tuturor membrilor dispar (confirmare în pagină). */
export async function resetAllNotificationPreferences(): Promise<GcsResult<null>> {
  return runAcpAction(NOTIFICATIONS_ACP_SECTION, "delete", async (actor) => {
    await services().notifications.resetAllPreferences(actor);
    return null;
  });
}

/** „Resetează valorile implicite”: tipurile revin la valorile modulelor lor, fără blocări (confirmare în pagină). */
export async function resetNotificationDefaults(): Promise<GcsResult<null>> {
  return runAcpAction(NOTIFICATIONS_ACP_SECTION, "delete", async (actor) => {
    await services().notifications.resetDefaults(actor);
    return null;
  });
}

/** „Oprește toate emailurile” pentru un membru (după nume sau email) sau „Repornește” (`off=0`, după id). */
export async function setMemberEmailsOff(fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(NOTIFICATIONS_ACP_SECTION, "edit", async (actor) => {
    const { db, notifications } = services();
    const off = field(fd, "off") !== "0";
    const id = field(fd, "userId");
    const who = field(fd, "member").trim();
    const user = id
      ? await db.user.findUnique({ where: { id }, select: { id: true } })
      : who
        ? await db.user.findFirst({ where: { OR: [{ nameNormalized: normalizeUsername(who) }, { email: who.toLowerCase() }] }, select: { id: true } })
        : null;
    if (!user) throw new GcsValidationError({ member: "member_not_found" });
    await notifications.setEmailsOff(actor, user.id, off);
    return null;
  });
}
