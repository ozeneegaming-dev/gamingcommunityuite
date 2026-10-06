"use server";

import type { GcsResult } from "@gcs/core";
import { CHAT_ACP_CHANNELS, CHAT_ACP_SETTINGS } from "@gcs/modules";
import { field, intField, runAcpAction } from "@/lib/acp-actions";
import { services } from "@/lib/services";

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
