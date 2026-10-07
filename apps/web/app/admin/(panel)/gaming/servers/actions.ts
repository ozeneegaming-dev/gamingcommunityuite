"use server";

import type { GcsResult } from "@gcs/core";
import { SERVERS_ACP_SECTION, type GcsServerStatus, type GcsServerTestInput } from "@gcs/modules";
import { field, intField, runAcpAction } from "@/lib/acp-actions";
import { services } from "@/lib/services";

const optionalInt = (fd: FormData, name: string) => (field(fd, name).trim() === "" ? null : intField(fd, name));

/**
 * Adăugarea (`id = null`) sau editarea unui server. Bannerul vine deja încărcat (`bannerId`, prin `/api/servers/banner`);
 * `removeBanner` îl scoate; fără niciunul, bannerul rămâne cum e.
 */
export async function saveServer(id: number | null, fd: FormData): Promise<GcsResult<{ id: number }>> {
  return runAcpAction(SERVERS_ACP_SECTION, "edit", async (actor) => {
    const bannerId = field(fd, "bannerId").trim();
    return services().servers.save(actor, id, {
      game: field(fd, "game"),
      host: field(fd, "host"),
      port: intField(fd, "port"),
      queryPort: optionalInt(fd, "queryPort"),
      name: field(fd, "name"),
      description: field(fd, "description"),
      forumId: optionalInt(fd, "forumId"),
      groups: fd.getAll("groups").map(Number).filter(Number.isInteger),
      adminIds: fd.getAll("adminIds").filter((v): v is string => typeof v === "string"),
      enabled: fd.get("enabled") === "on",
      ...(bannerId ? { bannerId } : fd.get("removeBanner") === "on" ? { bannerId: null } : {}),
    });
  });
}

export async function deleteServer(id: number): Promise<GcsResult<null>> {
  return runAcpAction(SERVERS_ACP_SECTION, "delete", async (actor) => {
    await services().servers.remove(actor, id);
    return null;
  });
}

export async function reorderServers(ids: number[]): Promise<GcsResult<null>> {
  return runAcpAction(SERVERS_ACP_SECTION, "edit", async (actor) => {
    await services().servers.reorder(actor, ids);
    return null;
  });
}

/** Butonul „Testează”: o interogare a adresei din formular (fără salvare). */
export async function testServer(input: GcsServerTestInput): Promise<GcsResult<GcsServerStatus>> {
  return runAcpAction(SERVERS_ACP_SECTION, "edit", async (actor) => services().servers.test(actor, input));
}
