"use server";

import { GcsValidationError, type GcsResult } from "@gcs/core";
import { FORUMS_ACP_SECTION, type GcsWizardInput, type GcsWizardResult } from "@gcs/modules";
import { runAcpAction } from "@/lib/acp-actions";
import { services } from "@/lib/services";

/** Asistentul „Creează categorie”: o categorie simplă (doar numele și descrierea). */
export async function createSimpleCategory(input: { name: string; description: string }): Promise<GcsResult<{ id: number }>> {
  return runAcpAction(FORUMS_ACP_SECTION, "edit", async (actor) => {
    const forum = await services().forums.create({ parentId: null, type: "CATEGORY", name: String(input?.name ?? ""), description: String(input?.description ?? "") }, actor);
    return { id: forum.id };
  });
}

/** Asistentul „Creează categorie de servere” (aplicația Servere): totul se verifică înainte de orice creare. */
export async function createServerCategory(input: GcsWizardInput): Promise<GcsResult<GcsWizardResult>> {
  return runAcpAction(FORUMS_ACP_SECTION, "edit", async (actor) => {
    const { apps, serverWizard } = services();
    if (!(await apps.enabled("servers"))) throw new GcsValidationError({ type: "app_disabled" });
    return serverWizard.create(actor, input);
  });
}

/** Verificarea fără creare (butonul „Continuă” al pasului 3): erorile pe câmpuri, cu indexul serverului. */
export async function checkServerCategory(input: GcsWizardInput): Promise<GcsResult<null>> {
  return runAcpAction(FORUMS_ACP_SECTION, "edit", async (actor) => {
    await services().serverWizard.check(actor, input);
    return null;
  });
}
