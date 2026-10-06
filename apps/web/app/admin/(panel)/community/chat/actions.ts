"use server";

import { GcsValidationError, type GcsResult } from "@gcs/core";
import { CHAT_ACP_CHANNELS, CHAT_ACP_SETTINGS, CHAT_CONTAINER, CHAT_DISPLAY_SETTINGS } from "@gcs/modules";
import { field, intField, runAcpAction } from "@/lib/acp-actions";
import { services } from "@/lib/services";
import { saveSettingDefs } from "@/lib/settings-save";
import { CHAT_SETTINGS_TABS, POLL_FIELD, type GcsChatSettingsTab } from "./settings/tabs";

const channelFields = (fd: FormData) => ({
  name: field(fd, "name"),
  description: field(fd, "description"),
  slowModeSeconds: intField(fd, "slowModeSeconds"),
  retentionDays: intField(fd, "retentionDays"),
  enabled: fd.get("enabled") === "on",
  showOnHome: fd.get("showOnHome") === "on",
});

export async function createChatChannel(fd: FormData): Promise<GcsResult<{ key: string }>> {
  return runAcpAction(CHAT_ACP_CHANNELS, "edit", async (actor) => {
    const channel = await services().chat.createChannel(actor, { key: field(fd, "key").trim().toLowerCase(), ...channelFields(fd) });
    return { key: channel.key };
  });
}

export async function updateChatChannel(key: string, fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(CHAT_ACP_CHANNELS, "edit", async (actor) => {
    await services().chat.updateChannel(actor, key, channelFields(fd));
    return null;
  });
}

export async function deleteChatChannel(key: string): Promise<GcsResult<null>> {
  return runAcpAction(CHAT_ACP_CHANNELS, "delete", async (actor) => {
    await services().chat.deleteChannel(actor, key);
    return null;
  });
}

/**
 * Un tab din ACP → Chat → Setări (General sau Avansat). Câmpurile speciale: `none:<cheie>` („Niciunul” / „Nelimitat”
 * bifat → 0), intervalul de actualizare în milisecunde (păstrat în secunde) și, pe General, starea aplicației Chat
 * (`app:chat`, la fel ca în ACP → Sistem → Aplicații; cere dreptul pe aplicații).
 */
export async function saveChatSettings(tab: GcsChatSettingsTab, fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(CHAT_ACP_SETTINGS, "edit", async (actor) => {
    const keys: readonly string[] = CHAT_SETTINGS_TABS[tab] ?? [];
    if (keys.length === 0) throw new GcsValidationError({ tab: "invalid_choice" });
    for (const key of keys) if (fd.get(`none:${key}`) === "on") fd.set(`setting:${key}`, "0");
    if (fd.has(POLL_FIELD)) {
      const ms = field(fd, POLL_FIELD).trim();
      fd.set("setting:chat.poll_interval", /^\d+$/.test(ms) ? String(Math.round(Number(ms) / 1000)) : "x");
    }
    if (tab === "general" && fd.has("app:present")) {
      const { apps } = services();
      const enabled = fd.get("app:chat") === "on";
      if ((await apps.enabled("chat")) !== enabled) await apps.setEnabled(actor, "chat", enabled);
    }
    await saveSettingDefs(
      CHAT_DISPLAY_SETTINGS.filter((d) => keys.includes(d.key)),
      fd,
      actor,
    );
    return null;
  });
}

/**
 * Tab-ul „Permisiuni”: cine citește și cine scrie în canalul General (matricea containerului `chat:general`) și cine
 * moderează chat-ul (`chat.moderate`, pe grup). Scrierea trece prin serviciul grupurilor (cere și dreptul pe grupuri).
 */
export async function saveChatPermissions(fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(CHAT_ACP_SETTINGS, "edit", async (actor) => {
    const { db, groups, registry } = services();
    const channel = "general";
    const rows = await db.group.findMany({ select: { id: true, key: true, settings: { where: { key: "chat.moderate" }, select: { value: true } } } });
    // Acțiunile containerului afișate în tab; celelalte (dacă un modul adaugă altele) rămân cum sunt.
    const shown = ["chat.read", "chat.write"];
    const kept = await db.containerPermission.findMany({
      where: { containerType: CHAT_CONTAINER, containerId: channel, action: { notIn: shown } },
      select: { groupId: true, action: true },
    });
    const matrix: Record<number, string[]> = {};
    for (const r of kept) (matrix[r.groupId] ??= []).push(r.action);
    for (const g of rows) {
      for (const action of shown) if (fd.get(`${action}:${g.id}`) === "on") (matrix[g.id] ??= []).push(action);
    }
    await groups.setContainerPermissions(CHAT_CONTAINER, channel, matrix, actor);
    const def = registry.permissionDef("chat.moderate");
    for (const g of rows) {
      const stored = g.settings[0]?.value;
      const current = (stored ?? def?.default[g.key] ?? false) === true;
      const wanted = fd.get(`chat.moderate:${g.id}`) === "on";
      if (current !== wanted) await groups.setSetting(g.id, "chat.moderate", wanted, actor);
    }
    return null;
  });
}

/** Filtrul de cuvinte: un cuvânt (sau o expresie) pe rând. */
export async function saveChatWordFilter(fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(CHAT_ACP_SETTINGS, "edit", async (actor) => {
    const words = [
      ...new Set(
        field(fd, "words")
          .split(/\r?\n/)
          .map((w) => w.trim())
          .filter(Boolean),
      ),
    ];
    await services().settings.set("chat.word_filter", words, actor);
    return null;
  });
}

export async function liftChatMute(id: number): Promise<GcsResult<null>> {
  return runAcpAction(CHAT_ACP_SETTINGS, "edit", async (actor) => {
    await services().chat.unmute(actor, id);
    return null;
  });
}

/** Șterge un anunț global al chat-ului (dispare live din toate camerele). */
export async function removeAnnouncement(id: number): Promise<GcsResult<null>> {
  return runAcpAction(CHAT_ACP_CHANNELS, "delete", async (actor) => {
    await services().chat.removeAnnouncement(actor, id);
    return null;
  });
}
