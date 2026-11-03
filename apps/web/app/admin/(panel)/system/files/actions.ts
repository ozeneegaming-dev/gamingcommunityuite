"use server";

import type { GcsResult } from "@gcs/core";
import { FILES_ACP_SECTION } from "@gcs/modules";
import { runAcpAction } from "@/lib/acp-actions";
import { services } from "@/lib/services";

/** Șterge un fișier (din panoul lui). */
export async function deleteFile(id: string): Promise<GcsResult<number>> {
  return runAcpAction(FILES_ACP_SECTION, "edit", (actor) => services().fileAdmin.remove(actor, [id]));
}

/** Șterge fișierele bifate în listă (cel mult 200 deodată). */
export async function deleteFiles(fd: FormData): Promise<GcsResult<number>> {
  return runAcpAction(FILES_ACP_SECTION, "edit", (actor) =>
    services().fileAdmin.remove(
      actor,
      fd.getAll("ids").filter((v): v is string => typeof v === "string" && v !== ""),
    ),
  );
}
