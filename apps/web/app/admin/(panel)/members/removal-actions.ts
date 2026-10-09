"use server";

import { DELETION_COOLING_SETTING, GDPR_ACP_SECTION, GcsValidationError, MEMBER_REMOVAL_ACP_SECTION, normalizeUsername, type GcsResult } from "@gcs/core";
import { field, intField, runAcpAction } from "@/lib/acp-actions";
import { services } from "@/lib/services";

/** Confirmarea: staff-ul scrie numele contului care dispare (litere mari / mici și diacriticele nu contează). */
async function assertConfirmed(userId: string, fd: FormData): Promise<void> {
  const user = await services().db.user.findUnique({ where: { id: userId }, select: { name: true } });
  if (!user || normalizeUsername(field(fd, "confirm").trim()) !== normalizeUsername(user.name)) throw new GcsValidationError({ confirm: "confirm_mismatch" });
}

/**
 * „Șterge membrul” (specul 2026-10-09-stergere-unire-membri §2): modul ales, opțiunea mesajelor private și confirmarea cu
 * numele. Întoarce id-ul operației (pagina de progres).
 */
export async function deleteMember(userId: string, fd: FormData): Promise<GcsResult<{ id: string }>> {
  return runAcpAction(MEMBER_REMOVAL_ACP_SECTION, "delete", async (actor) => {
    await assertConfirmed(userId, fd);
    const mode = field(fd, "mode") === "DELETE_CONTENT" ? "DELETE_CONTENT" : "KEEP_CONTENT";
    const row = await services().memberRemoval.requestDelete(actor, userId, { mode, keepMessages: fd.get("keepMessages") === "on" });
    return { id: row.id };
  });
}

/** „Unește cu alt cont” (specul §4): sursa se mută în țintă, apoi se șterge. Confirmarea cere numele sursei. */
export async function mergeMembers(sourceId: string, targetId: string, fd: FormData): Promise<GcsResult<{ id: string }>> {
  return runAcpAction(MEMBER_REMOVAL_ACP_SECTION, "delete", async (actor) => {
    await assertConfirmed(sourceId, fd);
    const row = await services().memberRemoval.requestMerge(actor, sourceId, targetId);
    return { id: row.id };
  });
}

export async function cancelRemoval(id: string): Promise<GcsResult<null>> {
  return runAcpAction(GDPR_ACP_SECTION, "edit", async (actor) => {
    await services().memberRemoval.cancel(actor, id);
    return null;
  });
}

export async function runRemovalNow(id: string): Promise<GcsResult<null>> {
  return runAcpAction(GDPR_ACP_SECTION, "edit", async (actor) => {
    await services().memberRemoval.runNow(actor, id);
    return null;
  });
}

export async function retryRemoval(id: string): Promise<GcsResult<null>> {
  return runAcpAction(GDPR_ACP_SECTION, "edit", async (actor) => {
    await services().memberRemoval.retry(actor, id);
    return null;
  });
}

/** Perioada de răzgândire a cererilor membrilor (zile, 0–90). */
export async function saveDeletionCooling(fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(GDPR_ACP_SECTION, "edit", async (actor) => {
    await services().settings.set(DELETION_COOLING_SETTING, intField(fd, "days"), actor);
    return null;
  });
}
