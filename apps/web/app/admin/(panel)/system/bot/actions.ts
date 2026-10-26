"use server";

import { GcsValidationError, type GcsResult } from "@gcs/core";
import { BOT_ACP_SECTION, BOT_WELCOME_SETTING, BOT_WELCOME_TITLE_SETTING } from "@gcs/modules";
import { field, intField, runAcpAction } from "@/lib/acp-actions";
import { services } from "@/lib/services";

/** Numele contului-bot. */
export async function renameBotAction(fd: FormData): Promise<GcsResult<void>> {
  return runAcpAction(BOT_ACP_SECTION, "edit", (actor) => services().communityBot.rename(actor, field(fd, "name")));
}

/** Avatarul botului (o imagine încărcată). */
export async function botAvatarAction(fd: FormData): Promise<GcsResult<{ url: string }>> {
  return runAcpAction(BOT_ACP_SECTION, "edit", async (actor) => {
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) throw new GcsValidationError({ file: "required" });
    const url = await services().communityBot.setAvatar(actor, { name: file.name, bytes: Buffer.from(await file.arrayBuffer()) });
    return { url };
  });
}

/** Comutatorul unei funcții (`feature`, `on` = "1" / "0"). */
export async function toggleBotFeatureAction(fd: FormData): Promise<GcsResult<void>> {
  return runAcpAction(BOT_ACP_SECTION, "edit", (actor) => services().communityBot.toggle(actor, field(fd, "feature"), field(fd, "on") === "1"));
}

/** Titlul și textul mesajului de bun venit. */
export async function saveBotWelcomeAction(fd: FormData): Promise<GcsResult<void>> {
  return runAcpAction(BOT_ACP_SECTION, "edit", async (actor) => {
    const { settings } = services();
    await settings.set(BOT_WELCOME_TITLE_SETTING, field(fd, "title").trim(), actor);
    await settings.set(BOT_WELCOME_SETTING, field(fd, "text").trim(), actor);
  });
}

/** O postare programată: forumul, titlul, conținutul (documentul editorului), data și opțiunile. */
export async function scheduleBotPostAction(fd: FormData): Promise<GcsResult<{ id: number }>> {
  return runAcpAction(BOT_ACP_SECTION, "edit", async (actor) => {
    let content: unknown = null;
    try {
      content = JSON.parse(field(fd, "content") || "null");
    } catch {
      throw new GcsValidationError({ content: "required" });
    }
    // `datetime-local` vine fără fus orar: se citește în fusul site-ului (diferența trimisă de browser, în minute).
    const local = field(fd, "publishAt");
    const offset = intField(fd, "tzOffset");
    const at = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local) ? new Date(`${local}:00Z`) : new Date(Number.NaN);
    const publishAt = Number.isNaN(offset) ? at : new Date(at.getTime() + offset * 60_000);
    return services().communityBot.schedule(actor, {
      forumId: intField(fd, "forumId"),
      title: field(fd, "title"),
      content,
      publishAt,
      lock: fd.get("lock") === "on",
      pin: fd.get("pin") === "on",
    });
  });
}

export async function unscheduleBotPostAction(fd: FormData): Promise<GcsResult<void>> {
  return runAcpAction(BOT_ACP_SECTION, "delete", (actor) => services().communityBot.unschedule(actor, intField(fd, "id")));
}
