"use server";

import type { GcsResult } from "@gcs/core";
import { field, runAcpAction } from "@/lib/acp-actions";
import { services } from "@/lib/services";

/**
 * Salvează matricea grupuri × acțiuni a unui container (câmpurile `allow:<groupId>:<cheie>`)
 * și moștenirea de la părinte. Cu moștenirea activă, matricea proprie rămâne salvată, dar nu se mai folosește.
 */
export async function saveContainerPermissions(containerType: string, containerId: string, fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction("members.groups", "edit", async (actor) => {
    const { groups, registry } = services();
    const actions = new Set(
      registry.permissionDefs().filter((d) => d.scope === "container" && d.containerType === containerType).map((d) => d.key),
    );
    const matrix: Record<number, string[]> = {};
    for (const [name, value] of fd.entries()) {
      const m = /^allow:(\d+):(.+)$/.exec(name);
      if (!m || value !== "on" || !actions.has(m[2]!)) continue;
      (matrix[Number(m[1])] ??= []).push(m[2]!);
    }
    const inherits = fd.get("inherits") === "on";
    const parentId = field(fd, "parentId").trim() || null;
    // Cu moștenirea bifată, tabelul e dezactivat în formular (nu se trimite), deci matricea proprie rămâne neatinsă.
    if (!inherits) await groups.setContainerPermissions(containerType, containerId, matrix, actor);
    await groups.setContainerInherit(containerType, containerId, { parentId, inherits: inherits && parentId !== null }, actor);
    return null;
  });
}
