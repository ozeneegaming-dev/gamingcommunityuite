"use server";

import { GcsForbidden, GcsValidationError, type GcsResult } from "@gcs/core";
import { GROUPS_PRO_APP, type GcsLegendTree } from "@gcs/modules";
import { isGcsIcon } from "@gcs/ui/icon-registry";
import { runAcpAction } from "@/lib/acp-actions";
import { services } from "@/lib/services";

/**
 * Salvează pagina ACP → Membri → Legenda grupurilor (dreptul de editare a grupurilor, aplicația Grupuri Pro pornită și
 * accesibilă adminului): categoriile (iconițele din registrul de iconițe), opțiunile de afișare și locul grupurilor.
 * Serviciul validează restul și golește cache-ul legendei.
 */
export async function saveGroupsLegend(tree: GcsLegendTree): Promise<GcsResult<null>> {
  return runAcpAction("members.groups", "edit", async (actor) => {
    const { apps, groupsPro } = services();
    if (!(await apps.canAccess(actor, GROUPS_PRO_APP))) throw new GcsForbidden({ reason: "app_disabled" });
    const categories: unknown[] = Array.isArray(tree?.categories) ? tree.categories : [];
    if (categories.some((c) => typeof c === "object" && c !== null && "icon" in c && !isGcsIcon((c as { icon: unknown }).icon as string))) {
      throw new GcsValidationError({ icon: "invalid_choice" });
    }
    await groupsPro.saveLayout(tree, actor);
    return null;
  });
}
