"use server";

import { GcsValidationError, type GcsResult } from "@gcs/core";
import { REFERRAL_ACP_SECTION, referralConfigError, type GcsReferralConfig } from "@gcs/modules";
import { field, intField, runAcpAction } from "@/lib/acp-actions";
import { services } from "@/lib/services";

/** Setările recomandărilor (panoul „Setări”). */
export async function saveReferralConfig(fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(REFERRAL_ACP_SECTION, "edit", async (actor) => {
    const value: GcsReferralConfig = {
      enabled: field(fd, "enabled") === "on",
      qualifyPosts: intField(fd, "qualifyPosts"),
      requireVerified: field(fd, "requireVerified") === "on",
      rewardPoints: intField(fd, "rewardPoints"),
      maxPerMember: intField(fd, "maxPerMember"),
    };
    const error = referralConfigError(value);
    if (error) throw new GcsValidationError({ qualifyPosts: error });
    await services().referrals.saveConfig(actor, value);
    return null;
  });
}

export async function deleteReferral(id: number): Promise<GcsResult<null>> {
  return runAcpAction(REFERRAL_ACP_SECTION, "delete", async (actor) => {
    await services().referrals.remove(actor, id);
    return null;
  });
}
