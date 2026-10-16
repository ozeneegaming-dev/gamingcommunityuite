"use server";

import { GCS_CHANNEL_STATES, GCS_EMAIL_MODES, GcsForbidden } from "@gcs/core";
import * as z from "zod";
import { gcsAction } from "@/lib/actions";
import { notificationTab } from "@/lib/notifications";
import { services } from "@/lib/services";

const guest = () => new GcsForbidden({ reason: "guest" });
const ids = z.array(z.number().int().positive()).max(100);

/** Tipurile unui tab al paginii (`all` = toate), validate pe server. */
async function tabTypes(tab: string | undefined): Promise<string[] | undefined> {
  if (!tab || tab === "all") return undefined;
  return (await notificationTab(tab)).tab.types ?? undefined;
}

/**
 * Marchează citite notificările date sau pe toate (dintr-un tab). `click`: deschise din clopoțel / pagină (statisticile
 * „deschise” pe canalul site). Întoarce numărul nou de necitite.
 */
export const markNotificationsRead = gcsAction(
  z.object({ ids: z.union([z.literal("all"), ids]), tab: z.string().max(40).optional(), click: z.boolean().optional() }),
  async ({ ids: which, tab, click }, { actor }) => {
    if (!actor.userId) throw guest();
    const { notifications } = services();
    const types = await tabTypes(tab);
    const unread = await notifications.markRead(actor.userId, which, types ? { types } : {});
    if (click && Array.isArray(which)) for (const id of which) await notifications.recordClick(actor.userId, id, "site");
    return { unread };
  },
);

/** Marchează din nou necitită o notificare (pagina notificărilor). */
export const markNotificationUnread = gcsAction(z.object({ id: z.number().int().positive() }), async ({ id }, { actor }) => {
  if (!actor.userId) throw guest();
  return { unread: await services().notifications.markUnread(actor.userId, id) };
});

/** Șterge notificările date, pe cele citite sau pe toate (dintr-un tab). */
export const deleteNotifications = gcsAction(
  z.object({ which: z.union([z.literal("read"), z.literal("all"), ids]), tab: z.string().max(40).optional() }),
  async ({ which, tab }, { actor }) => {
    if (!actor.userId) throw guest();
    const types = await tabTypes(tab);
    return { unread: await services().notifications.remove(actor.userId, which, types ? { types } : {}) };
  },
);

const state = z.enum(GCS_CHANNEL_STATES);
const channelsSchema = z.object({ site: state.optional(), toast: state.optional(), email: state.optional(), push: state.optional(), emailMode: z.enum(GCS_EMAIL_MODES).optional() });

/**
 * Preferințele membrului (Setări → Notificări): pe fiecare tip, starea fiecărui canal și modul emailului. Canalele
 * blocate din ACP se ignoră pe server.
 */
export const saveNotificationPreferences = gcsAction(z.object({ prefs: z.record(z.string().max(64), channelsSchema) }), async ({ prefs }, { actor }) => {
  if (!actor.userId) throw guest();
  await services().notifications.setPreferences(actor.userId, prefs);
});

/** „Resetează la implicit” (membrul): toate alegerile lui dispar. */
export const resetNotificationPreferences = gcsAction(z.object({}), async (_input, { actor }) => {
  if (!actor.userId) throw guest();
  return { removed: await services().notifications.resetPreferences(actor.userId) };
});

/** Abonamentul web push al acestui browser (după permisiunea dată din setări). */
export const subscribePush = gcsAction(
  z.object({ endpoint: z.string().max(1024), keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }), userAgent: z.string().max(300).optional() }),
  async ({ endpoint, keys, userAgent }, { actor }) => {
    if (!actor.userId) throw guest();
    return services().push.subscribe(actor.userId, { endpoint, p256dh: keys.p256dh, auth: keys.auth, userAgent: userAgent ?? "" });
  },
);

/** Scoate un dispozitiv (lista din setări) sau abonamentul acestui browser (după adresă). */
export const unsubscribePush = gcsAction(z.object({ id: z.number().int().positive().optional(), endpoint: z.string().max(1024).optional() }), async (input, { actor }) => {
  if (!actor.userId) throw guest();
  return { removed: await services().push.unsubscribe(actor.userId, { ...(input.id !== undefined ? { id: input.id } : {}), ...(input.endpoint ? { endpoint: input.endpoint } : {}) }) };
});
