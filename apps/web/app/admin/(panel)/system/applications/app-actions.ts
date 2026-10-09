"use server";

import { APPS_ACP_SECTION, type GcsResult } from "@gcs/core";
import { revalidatePath } from "next/cache";
import { runAcpAction } from "@/lib/acp-actions";
import { services } from "@/lib/services";

const PATH = "/admin/system/applications";

/**
 * Acțiunile paginii Aplicații (specul 2026-10-09-acp-navigatie-aplicatii §2): pornirea / oprirea unei aplicații, pagina
 * de pornire, accesul pe grup și ordinea. Dreptul (`system.applications`, edit) îl verifică serviciul; `runAcpAction`
 * verifică poarta ACP și întoarce `{ ok: false }` la eroare.
 */
export async function toggleApp(key: string, enabled: boolean): Promise<GcsResult<null>> {
  return runAcpAction(APPS_ACP_SECTION, "edit", async (actor) => {
    await services().apps.setEnabled(actor, key, enabled);
    revalidatePath(PATH);
    return null;
  });
}

export async function setLandingApp(key: string): Promise<GcsResult<null>> {
  return runAcpAction(APPS_ACP_SECTION, "edit", async (actor) => {
    await services().apps.setLanding(actor, key);
    revalidatePath(PATH);
    return null;
  });
}

/** Grupurile care pot accesa o aplicație (sau o secțiune a ei): `groupIds` primesc permisiunea, celelalte o pierd. */
export async function saveAppAccess(permission: string, groupIds: number[]): Promise<GcsResult<{ allowed: number[] }>> {
  return runAcpAction(APPS_ACP_SECTION, "edit", async (actor) => {
    const { apps } = services();
    await apps.setAccess(actor, permission, groupIds);
    revalidatePath(PATH);
    return { allowed: await apps.accessGroups(permission) };
  });
}

/** Ordinea aplicațiilor (cheile modulelor): lista din ACP și itemii aplicațiilor din meniul principal. */
export async function saveAppOrder(keys: string[]): Promise<GcsResult<null>> {
  return runAcpAction(APPS_ACP_SECTION, "edit", async (actor) => {
    const { apps, nav } = services();
    const order = await apps.setOrder(actor, keys);
    await nav.applyAppOrder(actor, order);
    revalidatePath(PATH);
    return null;
  });
}
