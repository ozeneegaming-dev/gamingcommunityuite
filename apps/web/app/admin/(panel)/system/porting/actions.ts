"use server";

import type { GcsResult } from "@gcs/core";
import { PORTING_ACP_SECTION, type GcsPortRightsBasis, type GcsPortView } from "@gcs/modules";
import { revalidatePath } from "next/cache";
import { getLocale } from "next-intl/server";
import { field, runAcpAction } from "@/lib/acp-actions";
import { services } from "@/lib/services";

const PATH = "/admin/system/porting";

/**
 * Conversia (pașii 2–3 ai asistentului): temeiul dreptului, bifa de confirmare și cheia pluginului, verificate de
 * serviciu (fără bifă și temei valid nu se convertește nimic). `PORTING.md` se scrie în limba adminului (ro / en).
 */
export async function convertPortAction(id: string, fd: FormData): Promise<GcsResult<GcsPortView>> {
  return runAcpAction(PORTING_ACP_SECTION, "edit", async (actor) => {
    const locale = await getLocale();
    const view = await services().porting.convert(actor, String(id), {
      basis: field(fd, "basis") as GcsPortRightsBasis,
      confirmed: fd.get("confirmed") === "on",
      key: field(fd, "key").trim().slice(0, 100),
      locale: locale === "ro" ? "ro" : "en",
    });
    revalidatePath(PATH);
    return view;
  });
}

/**
 * „Trimite la instalare”: pachetul generat devine o încărcare în așteptare a instalatorului de pluginuri (ecranul lui
 * de validare și confirmare). Nimic nu se instalează sau activează de aici.
 */
export async function handoffPortAction(id: string): Promise<GcsResult<{ uploadId: string }>> {
  return runAcpAction(PORTING_ACP_SECTION, "edit", (actor) => services().porting.handoff(actor, String(id)));
}

/** Ștergerea portării și a arhivelor ei; asistentul revine apoi la încărcare (navigarea o face clientul). */
export async function deletePortAction(id: string): Promise<GcsResult<null>> {
  return runAcpAction(PORTING_ACP_SECTION, "delete", async (actor) => {
    await services().porting.delete(actor, String(id));
    return null;
  });
}
