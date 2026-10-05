"use server";

import { GcsForbidden, toResult, type GcsAcpLayout, type GcsAcpSearchResult, type GcsResult } from "@gcs/core";
import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { isSameOrigin } from "@/lib/actions";
import { assertAcpAction, getAcpContext } from "@/lib/acp";
import { services } from "@/lib/services";

/** Preferințele personale (layout, ordinea aplicațiilor) cer doar o sesiune ACP validă. */
async function acpUser(): Promise<{ userId: string }> {
  if (!isSameOrigin(await headers())) throw new GcsForbidden({ reason: "csrf" });
  const ctx = await getAcpContext();
  if (ctx.state !== "ok") throw new GcsForbidden({ reason: "acp_gate" });
  return { userId: ctx.user.id };
}

export async function saveAcpLayout(layout: Omit<GcsAcpLayout, "appOrder">): Promise<GcsResult<GcsAcpLayout>> {
  return toResult(async () => {
    const { userId } = await acpUser();
    const { acpDashboard } = services();
    const current = await acpDashboard.getLayout(userId);
    return acpDashboard.saveLayout(userId, { ...layout, appOrder: current.appOrder });
  });
}

export async function saveAppOrder(appOrder: string[]): Promise<GcsResult<GcsAcpLayout>> {
  return toResult(async () => {
    const { userId } = await acpUser();
    const { acpDashboard } = services();
    const current = await acpDashboard.getLayout(userId);
    return acpDashboard.saveLayout(userId, { ...current, appOrder });
  });
}

export async function saveAdminNote(body: string): Promise<GcsResult<null>> {
  return toResult(async () => {
    if (!isSameOrigin(await headers())) throw new GcsForbidden({ reason: "csrf" });
    const actor = await assertAcpAction("system.dashboard", "edit");
    await services().acpDashboard.saveNote(String(body), actor);
    return null;
  });
}

/** Căutarea live din header: setări (după eticheta tradusă), membri și grupuri, filtrate pe drepturi. */
export async function searchAcp(q: string): Promise<GcsAcpSearchResult[]> {
  const ctx = await getAcpContext();
  if (ctx.state !== "ok") return [];
  const t = await getTranslations();
  const translate = (key: string) => (t.has(key) ? t(key) : key);
  return services().acpSearch.search(String(q).slice(0, 100), ctx.actor, translate);
}
