"use server";

import { ANTISPAM_ACP_SECTION } from "@gcs/modules";
import type { GcsActor, GcsResult } from "@gcs/core";
import { field, intField, runAcpAction } from "@/lib/acp-actions";
import { services } from "@/lib/services";

const LOCALES = ["ro", "en", "de", "es", "fr", "ru"];

/** Salvează setările din formular, pe rând (fiecare trece prin validarea definiției ei). */
async function saveAll(actor: GcsActor, values: Record<string, unknown>): Promise<void> {
  for (const [key, value] of Object.entries(values)) await services().settings.set(key, value, actor);
}

export async function saveCaptchaAction(fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(ANTISPAM_ACP_SECTION, "edit", async (actor) => {
    await saveAll(actor, { "antispam.captcha": field(fd, "captcha"), "antispam.pow_difficulty": intField(fd, "difficulty"), "antispam.qa_enabled": fd.get("qa") === "on" });
    return null;
  });
}

export async function saveNewMembersAction(fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(ANTISPAM_ACP_SECTION, "edit", async (actor) => {
    await saveAll(actor, {
      "antispam.new_member_days": intField(fd, "days"),
      "antispam.new_member_posts": intField(fd, "posts"),
      "antispam.new_member_links": field(fd, "links"),
      "antispam.new_member_images": intField(fd, "images"),
      "antispam.new_member_pms_per_day": intField(fd, "pms"),
      "antispam.new_member_approval": fd.get("approval") === "on",
      "antispam.new_member_chat_slow": intField(fd, "chatSlow"),
    });
    return null;
  });
}

export async function savePhishingAction(fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(ANTISPAM_ACP_SECTION, "edit", async (actor) => {
    await saveAll(actor, { "antispam.phishing_enabled": fd.get("enabled") === "on", "antispam.phishing_domains": String(fd.get("blocked") ?? ""), "antispam.phishing_allow": String(fd.get("allowed") ?? "") });
    return null;
  });
}

/** Lista publică de spammeri; cheia goală o păstrează pe cea salvată (`clearKey` o șterge). */
export async function saveSpamSourceAction(fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(ANTISPAM_ACP_SECTION, "edit", async (actor) => {
    const key = field(fd, "apiKey");
    await saveAll(actor, {
      "antispam.sfs_enabled": fd.get("enabled") === "on",
      "antispam.sfs_confidence": intField(fd, "confidence"),
      ...(key ? { "antispam.sfs_api_key": key } : fd.get("clearKey") === "on" ? { "antispam.sfs_api_key": "" } : {}),
    });
    return null;
  });
}

/** O întrebare de la înregistrare; răspunsurile acceptate, câte unul pe rând. */
export async function saveQuestionAction(id: number | null, fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(ANTISPAM_ACP_SECTION, "edit", async (actor) => {
    const locale = field(fd, "locale");
    await services().antispam.saveQuestion(actor, {
      ...(id ? { id } : {}),
      locale: LOCALES.includes(locale) ? locale : null,
      question: field(fd, "question"),
      answers: String(fd.get("answers") ?? "").split(/\r?\n/),
      enabled: fd.get("enabled") === "on",
    });
    return null;
  });
}

export async function deleteQuestionAction(id: number): Promise<GcsResult<null>> {
  return runAcpAction(ANTISPAM_ACP_SECTION, "edit", async (actor) => {
    await services().antispam.deleteQuestion(actor, id);
    return null;
  });
}
