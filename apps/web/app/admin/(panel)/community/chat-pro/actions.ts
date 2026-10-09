"use server";

import { GcsValidationError, type GcsResult } from "@gcs/core";
import { CHAT_PRO_ACP_BAR, CHAT_PRO_ACP_EMOTES, CHAT_PRO_ACP_SETTINGS, CHAT_PRO_COMMANDS, CHAT_PRO_SETTINGS, type GcsChatProBarInput } from "@gcs/modules";
import { field, runAcpAction } from "@/lib/acp-actions";
import { services } from "@/lib/services";
import { saveSettingDefs } from "@/lib/settings-save";
import { CHAT_PRO_TABS, type GcsChatProTab } from "./tabs";

/**
 * Un tab din ACP → Comunitate → Chat Pro → Setări. Pe „General”: starea aplicației (`app:chat_pro`, ca în ACP → Sistem →
 * Aplicații, cu dreptul pe aplicații; pornirea cere Chat pornit) și comenzile active (comutatoarele `cmd:<cheie>`
 * devin lista `chat_pro.commands`).
 */
export async function saveChatProSettings(tab: GcsChatProTab, fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(CHAT_PRO_ACP_SETTINGS, "edit", async (actor) => {
    const keys: readonly string[] = CHAT_PRO_TABS[tab] ?? [];
    if (keys.length === 0) throw new GcsValidationError({ tab: "invalid_choice" });
    if (tab === "general") {
      fd.set("setting:chat_pro.commands", JSON.stringify(CHAT_PRO_COMMANDS.filter((c) => fd.get(`cmd:${c}`) === "on")));
      if (fd.has("app:present")) {
        const { apps } = services();
        const enabled = fd.get("app:chat_pro") === "on";
        const own = (await apps.catalog()).find((a) => a.key === "chat_pro")?.enabled ?? false;
        if (own !== enabled) await apps.setEnabled(actor, "chat_pro", enabled);
      }
    }
    await saveSettingDefs(
      CHAT_PRO_SETTINGS.filter((d) => keys.includes(d.key)),
      fd,
      actor,
    );
    return null;
  });
}

const barInput = (fd: FormData): GcsChatProBarInput => ({
  text: field(fd, "text"),
  ctaLabel: field(fd, "ctaLabel"),
  ctaUrl: field(fd, "ctaUrl"),
  // Câmpurile `datetime-local` sunt în ora browserului; clientul trimite ISO (cu fusul lui).
  startsAt: field(fd, "startsAt") || null,
  endsAt: field(fd, "endsAt") || null,
  groupIds: fd
    .getAll("groups")
    .map((v) => Number(v))
    .filter((n) => Number.isInteger(n) && n > 0),
  enabled: fd.get("enabled") === "on",
});

export async function saveChatProBarItem(id: number | null, fd: FormData): Promise<GcsResult<{ id: number }>> {
  return runAcpAction(CHAT_PRO_ACP_BAR, "edit", (actor) => services().chatPro.bar.save(actor, id, barInput(fd)));
}

export async function deleteChatProBarItem(id: number): Promise<GcsResult<null>> {
  return runAcpAction(CHAT_PRO_ACP_BAR, "delete", async (actor) => {
    await services().chatPro.bar.remove(actor, id);
    return null;
  });
}

export async function reorderChatProBar(ids: number[]): Promise<GcsResult<null>> {
  return runAcpAction(CHAT_PRO_ACP_BAR, "edit", async (actor) => {
    await services().chatPro.bar.reorder(actor, ids);
    return null;
  });
}

export async function saveChatEmotePack(id: number | null, fd: FormData): Promise<GcsResult<{ id: number }>> {
  return runAcpAction(CHAT_PRO_ACP_EMOTES, "edit", (actor) => services().chatPro.emotes.savePack(actor, id, { name: field(fd, "name"), enabled: fd.get("enabled") === "on" }));
}

export async function deleteChatEmotePack(id: number): Promise<GcsResult<null>> {
  return runAcpAction(CHAT_PRO_ACP_EMOTES, "delete", async (actor) => {
    await services().chatPro.emotes.deletePack(actor, id);
    return null;
  });
}

export async function renameChatEmote(id: number, code: string): Promise<GcsResult<null>> {
  return runAcpAction(CHAT_PRO_ACP_EMOTES, "edit", async (actor) => {
    await services().chatPro.emotes.rename(actor, id, code);
    return null;
  });
}

export async function deleteChatEmote(id: number): Promise<GcsResult<null>> {
  return runAcpAction(CHAT_PRO_ACP_EMOTES, "delete", async (actor) => {
    await services().chatPro.emotes.deleteEmote(actor, id);
    return null;
  });
}
