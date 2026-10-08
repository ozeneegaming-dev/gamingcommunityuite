"use server";

import type { GcsResult } from "@gcs/core";
import { SERVER_MAPS_ACP_SECTION } from "@gcs/modules";
import { runAcpAction } from "@/lib/acp-actions";
import { services } from "@/lib/services";

/** Scoate imaginea unei hărți (rămâne arta generică; șablonul de adresă o poate aduce din nou). */
export async function removeMapImage(id: number): Promise<GcsResult<null>> {
  return runAcpAction(SERVER_MAPS_ACP_SECTION, "delete", async (actor) => {
    await services().bridge.maps.removeImage(actor, id);
    return null;
  });
}
