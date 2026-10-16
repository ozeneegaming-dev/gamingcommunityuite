"use server";

import { MENUS_ACP_SECTION, type GcsNavItemInput, type GcsResult } from "@gcs/core";
import { runAcpAction } from "@/lib/acp-actions";
import { services } from "@/lib/services";

/** Manager meniu v2: ciorna (salvată automat la fiecare schimbare), văzută doar în previzualizare. */
export async function saveMenuDraft(items: GcsNavItemInput[]): Promise<GcsResult<{ savedAt: string }>> {
  return runAcpAction(MENUS_ACP_SECTION, "edit", async (actor) => {
    await services().nav.saveDraft(actor, items);
    return { savedAt: new Date().toISOString() };
  });
}

/** „Publică”: ciorna devine meniul site-ului. */
export async function publishMenuDraft(): Promise<GcsResult<{ published: boolean }>> {
  return runAcpAction(MENUS_ACP_SECTION, "edit", async (actor) => ({ published: await services().nav.publishDraft(actor) }));
}

/** „Renunță”: ciorna se șterge; editorul revine la meniul publicat. */
export async function discardMenuDraft(): Promise<GcsResult<null>> {
  return runAcpAction(MENUS_ACP_SECTION, "edit", async (actor) => {
    await services().nav.discardDraft(actor);
    return null;
  });
}

/** „Restaurează meniul implicit”: meniul implicit al aplicațiilor devine ciorna. */
export async function restoreMenuDefaults(): Promise<GcsResult<null>> {
  return runAcpAction(MENUS_ACP_SECTION, "edit", async (actor) => {
    await services().nav.restoreDefaultsToDraft(actor);
    return null;
  });
}
