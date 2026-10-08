"use server";

import type { GcsResult } from "@gcs/core";
import { SERVERS_ACP_SECTION, type GcsTvTestResult } from "@gcs/modules";
import { field, intField, runAcpAction } from "@/lib/acp-actions";
import { services } from "@/lib/services";

/**
 * ACP → Gaming → Servere → un server → Plugin și chei API → „HLTV / GOTV și demo-uri” (specul 2026-10-08-servere-hltv
 * §7): setările (secretele: gol = neschimbate, bifa „Șterge” le scoate; nu se trimit niciodată înapoi), testul
 * conexiunii și acțiunile pe demo-uri. Validarea, sigilarea și jurnalul le face serviciul.
 */

const optionalInt = (fd: FormData, name: string): number | null => (field(fd, name).trim() === "" ? null : intField(fd, name));

export async function saveServerTv(serverId: number, fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(SERVERS_ACP_SECTION, "edit", async (actor) => {
    await services().bridge.tv.save(actor, serverId, {
      address: field(fd, "address"),
      delay: optionalInt(fd, "delay"),
      source: field(fd, "source"),
      host: field(fd, "host"),
      port: optionalInt(fd, "port"),
      username: field(fd, "username"),
      password: field(fd, "password"),
      clearPassword: fd.get("clearPassword") === "on",
      privateKey: field(fd, "privateKey").trim() ? field(fd, "privateKey") : "",
      clearPrivateKey: fd.get("clearPrivateKey") === "on",
      remoteDir: field(fd, "remoteDir") || "/",
      tlsInsecure: fd.get("tlsInsecure") === "on",
      hostKey: field(fd, "hostKey").trim(),
      httpTemplate: field(fd, "httpTemplate").trim(),
      namePrefix: field(fd, "namePrefix").trim(),
      timeZone: field(fd, "timeZone").trim() || "UTC",
      record: fd.get("record") === "on",
      rconPassword: field(fd, "rconPassword"),
      clearRconPassword: fd.get("clearRconPassword") === "on",
    });
    return null;
  });
}

/** „Testează conexiunea”: cu setările salvate (10 / oră). */
export async function testServerTv(serverId: number): Promise<GcsResult<GcsTvTestResult>> {
  return runAcpAction(SERVERS_ACP_SECTION, "edit", (actor) => services().bridge.tv.test(actor, serverId));
}

/** „Caută din nou” demo-ul unui meci (jurnal `servers.demo.refetch`). */
export async function refetchMatchDemo(matchId: number): Promise<GcsResult<null>> {
  return runAcpAction(SERVERS_ACP_SECTION, "edit", async (actor) => {
    await services().bridge.demos.refetch(actor, matchId);
    return null;
  });
}

/** „Șterge” un demo (fișierul; rândul rămâne expirat; jurnal `servers.demo.delete`). */
export async function deleteMatchDemo(demoId: number): Promise<GcsResult<null>> {
  return runAcpAction(SERVERS_ACP_SECTION, "delete", async (actor) => {
    await services().bridge.demos.remove(actor, demoId);
    return null;
  });
}
