"use server";

import type { GcsResult } from "@gcs/core";
import { SERVERS_ACP_SECTION } from "@gcs/modules";
import { field, runAcpAction } from "@/lib/acp-actions";
import { services } from "@/lib/services";

/**
 * ACP → Gaming → Servere → un server → Plugin și chei API (specul 2026-10-08-servere-bridge §5.1, §15.3): cheile
 * (creare, rotire, revocare; cheia nouă se întoarce o singură dată), modul identităților și VIP-ul pe server.
 */

export async function createBridgeKey(serverId: number, fd: FormData): Promise<GcsResult<{ keyId: string; token: string }>> {
  return runAcpAction(SERVERS_ACP_SECTION, "edit", async (actor) => {
    const key = await services().bridge.keys.create(actor, serverId, { label: field(fd, "label") });
    return { keyId: key.keyId, token: key.token };
  });
}

export async function rotateBridgeKey(serverId: number, id: number): Promise<GcsResult<{ keyId: string; token: string }>> {
  return runAcpAction(SERVERS_ACP_SECTION, "edit", async (actor) => {
    const key = await services().bridge.keys.rotate(actor, serverId, id);
    return { keyId: key.keyId, token: key.token };
  });
}

export async function revokeBridgeKey(serverId: number, id: number): Promise<GcsResult<null>> {
  return runAcpAction(SERVERS_ACP_SECTION, "delete", async (actor) => {
    await services().bridge.keys.revoke(actor, serverId, id);
    return null;
  });
}

export async function saveBridgeConfig(serverId: number, fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(SERVERS_ACP_SECTION, "edit", async (actor) => {
    await services().bridge.saveConfig(actor, serverId, { identityMode: field(fd, "identityMode"), nameIds: fd.get("nameIds") === "on", isMix: fd.get("isMix") === "on" });
    return null;
  });
}

/**
 * Modulele opționale ale pluginului (specul 2026-10-08-servere-plugin-v2 §1.2): implicit oprite (pluginul doar
 * colectează date); bifate = GCS administrează acea parte a serverului. Pluginul le primește la următorul heartbeat.
 */
export async function saveBridgeModules(serverId: number, fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(SERVERS_ACP_SECTION, "edit", async (actor) => {
    await services().bridge.saveFeatures(actor, serverId, {
      manageAdmins: fd.get("manageAdmins") === "on",
      enforceSanctions: fd.get("enforceSanctions") === "on",
      manageVip: fd.get("manageVip") === "on",
      mixReady: fd.get("mixReady") === "on",
      adminCommands: fd.get("adminCommands") === "on",
    });
    return null;
  });
}

/** Grupurile VIP pe server: `vip` (id-urile pornite) și `flags:<id>` pentru fiecare grup. */
export async function saveVipMappings(serverId: number, fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(SERVERS_ACP_SECTION, "edit", async (actor) => {
    const groups = fd.getAll("group").map((v) => Number(v)).filter(Number.isInteger);
    const enabled = new Set(fd.getAll("vip").map((v) => Number(v)));
    await services().bridge.vip.saveMappings(
      actor,
      serverId,
      groups.map((groupId) => ({ groupId, enabled: enabled.has(groupId), flags: field(fd, `flags:${groupId}`) })),
    );
    return null;
  });
}

