"use server";

import type { GcsResult } from "@gcs/core";
import { SERVERS_ACP_SECTION, type GcsEnrollCheck } from "@gcs/modules";
import { runAcpAction } from "@/lib/acp-actions";
import { services } from "@/lib/services";

/**
 * ACP → Gaming → Servere → „Servere noi detectate” (specul 2026-10-08-servere-plugin-v2 §5.4): aprobarea (server nou sau
 * atașat la unul existent; cu interogarea neconfirmată doar cu `force`), respingerea, blocarea IP-ului și interogarea din
 * nou. Toate cer dreptul de editare al serverelor și intră în jurnal (în serviciu).
 */

export async function approveEnrollment(id: number, input: { serverId: number | null; force: boolean }): Promise<GcsResult<{ serverId: number; created: boolean }>> {
  return runAcpAction(SERVERS_ACP_SECTION, "edit", (actor) => services().bridge.enrollments.approve(actor, id, { serverId: input.serverId, force: input.force === true }));
}

export async function rejectEnrollment(id: number): Promise<GcsResult<null>> {
  return runAcpAction(SERVERS_ACP_SECTION, "edit", async (actor) => {
    await services().bridge.enrollments.reject(actor, id);
    return null;
  });
}

export async function blockEnrollmentIp(id: number): Promise<GcsResult<{ rejected: number }>> {
  return runAcpAction(SERVERS_ACP_SECTION, "edit", (actor) => services().bridge.enrollments.blockIp(actor, id));
}

export async function recheckEnrollment(id: number): Promise<GcsResult<GcsEnrollCheck>> {
  return runAcpAction(SERVERS_ACP_SECTION, "edit", (actor) => services().bridge.enrollments.recheck(actor, id));
}
