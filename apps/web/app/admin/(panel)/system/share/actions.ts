"use server";

import { GcsValidationError, type GcsResult } from "@gcs/core";
import { GCS_SHARE_NETWORKS, SHARE_ACP_SECTION, SHARE_SETTING, shareConfigError, type GcsShareConfig } from "@gcs/modules";
import { field, runAcpAction } from "@/lib/acp-actions";
import { services } from "@/lib/services";

/** Meniul „Distribuie” (panoul „Setări”): pornit, rețelele bifate, foaia nativă, hashtag-urile. */
export async function saveShareConfig(fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(SHARE_ACP_SECTION, "edit", async (actor) => {
    const value: GcsShareConfig = {
      enabled: field(fd, "enabled") === "on",
      networks: GCS_SHARE_NETWORKS.filter((n) => fd.get(`net:${n}`) === "on"),
      nativeShare: field(fd, "nativeShare") === "on",
      hashtags: field(fd, "hashtags").trim(),
    };
    const error = shareConfigError(value);
    if (error) throw new GcsValidationError({ [error === "invalid" ? "hashtags" : "networks"]: error });
    await services().settings.set(SHARE_SETTING, value, actor);
    return null;
  });
}
