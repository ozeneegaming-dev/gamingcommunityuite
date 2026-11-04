"use server";

import { APPS_ACP_SECTION, GcsConflict, writeAudit, type GcsMarketError, type GcsResult } from "@gcs/core";
import { revalidatePath } from "next/cache";
import { runAcpAction } from "@/lib/acp-actions";
import { MARKETPLACE_SECTION, marketOrder, marketOrderStatus, marketPackage } from "@/lib/marketplace.server";
import { services } from "@/lib/services";

const PATH = "/admin/system/marketplace";
const fail = (error: GcsMarketError): never => {
  throw new GcsConflict({ reason: `market_${error}` });
};

/**
 * Cumpărarea unui element: `paid` (gratuit, dat pe loc), `owned` (licența îl are) sau `pending` cu pagina de plată a
 * Data Center-ului, pe care ACP-ul o deschide într-o filă nouă.
 */
export async function buyMarketItem(itemId: number): Promise<GcsResult<{ status: "owned" | "paid" | "pending"; checkoutUrl: string | null; orderId: string | null }>> {
  return runAcpAction(MARKETPLACE_SECTION, "edit", async (actor) => {
    if (!Number.isInteger(itemId) || itemId <= 0) fail("not_found");
    const res = await marketOrder(itemId);
    if (!res.ok) return fail(res.error);
    await writeAudit(services().db, { actorId: actor.userId, action: "marketplace.order", targetType: "marketplace_item", targetId: String(itemId), after: { status: res.status, order: res.order?.id ?? null }, ip: actor.ip });
    if (res.status !== "pending") revalidatePath(PATH);
    return { status: res.status, checkoutUrl: res.order?.checkoutUrl ?? null, orderId: res.order?.id ?? null };
  });
}

/** Starea plății unei comenzi; după plată, licența ia tokenul nou (aplicația premium se poate porni). */
export async function checkMarketOrder(orderId: string): Promise<GcsResult<{ status: string }>> {
  return runAcpAction(MARKETPLACE_SECTION, "view", async () => {
    const res = await marketOrderStatus(orderId);
    if (!res.ok) return fail(res.error);
    if (res.status === "paid") {
      revalidatePath(PATH);
      revalidatePath("/admin/system/applications");
    }
    return { status: res.status };
  });
}

/** Pornește o aplicație premium cumpărată (aceeași verificare a licenței ca în ACP › Aplicații). */
export async function activateMarketApp(key: string): Promise<GcsResult<null>> {
  return runAcpAction(APPS_ACP_SECTION, "edit", async (actor) => {
    await services().apps.setEnabled(actor, key, true);
    revalidatePath(PATH);
    revalidatePath("/admin/system/applications");
    return null;
  });
}

/**
 * Descarcă pachetul unui element și îl pune la instalatorul de pluginuri: ACP-ul merge apoi pe ecranul de validare
 * (semnătura, permisiunile, confirmarea), exact ca la o încărcare de mână.
 */
export async function stageMarketPackage(itemId: number): Promise<GcsResult<{ installUrl: string }>> {
  return runAcpAction(APPS_ACP_SECTION, "edit", async (actor) => {
    if (!Number.isInteger(itemId) || itemId <= 0) fail("not_found");
    const res = await marketPackage(itemId);
    if (!res.ok) return fail(res.error);
    const { id } = await services().pluginAdmin.stage(actor, { fileName: `${res.slug || "package"}.zip`, data: res.data });
    return { installUrl: `/admin/system/applications/install/${id}` };
  });
}
