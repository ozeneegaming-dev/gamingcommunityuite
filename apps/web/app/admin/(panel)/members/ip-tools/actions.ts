"use server";

import type { GcsResult } from "@gcs/core";
import { IP_RETENTION_SETTING, IP_TOOLS_ACP_SECTION } from "@gcs/modules";
import { intField, runAcpAction } from "@/lib/acp-actions";
import { services } from "@/lib/services";

/** Păstrarea IP-urilor (GDPR): după câte zile se golesc (0 = se păstrează). */
export async function saveIpRetentionAction(fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(IP_TOOLS_ACP_SECTION, "edit", async (actor) => {
    await services().settings.set(IP_RETENTION_SETTING, intField(fd, "days"), actor);
    return null;
  });
}
