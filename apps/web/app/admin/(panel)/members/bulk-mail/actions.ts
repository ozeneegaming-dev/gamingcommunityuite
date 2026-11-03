"use server";

import { GcsValidationError, type GcsResult } from "@gcs/core";
import { BULK_MAIL_ACP_SECTION, BULK_MAIL_RATE_SETTING, type GcsBulkAudience } from "@gcs/modules";
import { field, intField, runAcpAction } from "@/lib/acp-actions";
import { services } from "@/lib/services";

/** Publicul din formular: grupurile bifate, „doar grupul principal”, „activi în ultimele N zile” (gol = oricând). */
function audienceOf(fd: FormData): GcsBulkAudience {
  const days = field(fd, "activeDays").trim();
  return {
    groupIds: fd
      .getAll("groupId")
      .map((v) => Number(v))
      .filter((n) => Number.isInteger(n) && n > 0),
    primaryOnly: field(fd, "primaryOnly") === "on",
    activeDays: days === "" ? null : intField(fd, "activeDays"),
  };
}

function bodyOf(fd: FormData): unknown {
  try {
    return JSON.parse(field(fd, "body") || "null");
  } catch {
    throw new GcsValidationError({ body: "required" });
  }
}

/** Ciorna: nouă (`id` = `null`) sau modificată. */
export async function saveBulkMail(id: number | null, fd: FormData): Promise<GcsResult<{ id: number }>> {
  return runAcpAction(BULK_MAIL_ACP_SECTION, "edit", (actor) => services().bulkMail.save(actor, id, { subject: field(fd, "subject"), body: bodyOf(fd), audience: audienceOf(fd) }));
}

/** Câți membri primesc emailul cu publicul ales acum (previzualizarea din formular). */
export async function countBulkAudience(audience: GcsBulkAudience): Promise<GcsResult<number>> {
  return runAcpAction(BULK_MAIL_ACP_SECTION, "view", (actor) => services().bulkMail.count(actor, audience));
}

export async function sendBulkTest(id: number): Promise<GcsResult<string>> {
  return runAcpAction(BULK_MAIL_ACP_SECTION, "edit", (actor) => services().bulkMail.sendTest(actor, id));
}

export async function startBulkMail(id: number): Promise<GcsResult<number>> {
  return runAcpAction(BULK_MAIL_ACP_SECTION, "edit", (actor) => services().bulkMail.start(actor, id));
}

export async function cancelBulkMail(id: number): Promise<GcsResult<null>> {
  return runAcpAction(BULK_MAIL_ACP_SECTION, "edit", async (actor) => {
    await services().bulkMail.cancel(actor, id);
    return null;
  });
}

export async function duplicateBulkMail(id: number): Promise<GcsResult<{ id: number }>> {
  return runAcpAction(BULK_MAIL_ACP_SECTION, "edit", (actor) => services().bulkMail.duplicate(actor, id));
}

export async function deleteBulkMail(id: number): Promise<GcsResult<null>> {
  return runAcpAction(BULK_MAIL_ACP_SECTION, "delete", async (actor) => {
    await services().bulkMail.remove(actor, id);
    return null;
  });
}

/** Ritmul trimiterii (emailuri pe minut). */
export async function saveBulkRate(fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(BULK_MAIL_ACP_SECTION, "edit", async (actor) => {
    await services().settings.set(BULK_MAIL_RATE_SETTING, intField(fd, "perMinute"), actor);
    return null;
  });
}
