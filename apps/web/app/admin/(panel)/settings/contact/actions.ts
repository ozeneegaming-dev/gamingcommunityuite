"use server";

import { GcsValidationError, type GcsResult } from "@gcs/core";
import { CONTACT_ACP_SECTION, contactConfigError, type GcsContactConfig, type GcsContactStatus } from "@gcs/modules";
import { field, intField, runAcpAction } from "@/lib/acp-actions";
import { services } from "@/lib/services";

/** O listă dintr-un câmp text: un element pe rând (sau separate prin virgulă, pentru adrese). */
const lines = (text: string, commas = false) =>
  text
    .split(commas ? /[\n,;]+/ : /\n+/)
    .map((s) => s.trim())
    .filter(Boolean);

/** Setările formularului de contact (panoul „Setări”). */
export async function saveContactConfig(fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(CONTACT_ACP_SECTION, "edit", async (actor) => {
    const value: GcsContactConfig = {
      enabled: field(fd, "enabled") === "on",
      guests: field(fd, "guests") === "on",
      intro: field(fd, "intro").trim(),
      subjects: [...new Set(lines(field(fd, "subjects")))],
      notifyStaff: field(fd, "notifyStaff") === "on",
      emails: [...new Set(lines(field(fd, "emails"), true).map((e) => e.toLowerCase()))],
      redirectUrl: field(fd, "redirectUrl").trim(),
      keepDays: intField(fd, "keepDays"),
    };
    const error = contactConfigError(value);
    if (error) {
      const at = error === "invalid_email" ? "emails" : error === "invalid_url" ? "redirectUrl" : error === "invalid_range" ? "keepDays" : error === "too_long" ? "intro" : "subjects";
      throw new GcsValidationError({ [at]: error });
    }
    await services().contact.saveConfig(actor, value);
    return null;
  });
}

/** Răspunsul pe email la un mesaj. */
export async function replyContact(id: number, fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(CONTACT_ACP_SECTION, "edit", async (actor) => {
    await services().contact.reply(actor, id, field(fd, "reply"));
    return null;
  });
}

/** Citit / arhivat / redeschis. */
export async function setContactStatus(id: number, status: GcsContactStatus): Promise<GcsResult<null>> {
  return runAcpAction(CONTACT_ACP_SECTION, "edit", async (actor) => {
    await services().contact.setStatus(actor, id, status);
    return null;
  });
}

export async function deleteContact(id: number): Promise<GcsResult<number>> {
  return runAcpAction(CONTACT_ACP_SECTION, "delete", (actor) => services().contact.remove(actor, [id]));
}
