"use server";

import type { GcsResult } from "@gcs/core";
import { WEBHOOKS_ACP_SECTION, type GcsWebhookDelivery } from "@gcs/modules";
import { field, runAcpAction } from "@/lib/acp-actions";
import { services } from "@/lib/services";

export async function saveWebhook(id: number | null, fd: FormData): Promise<GcsResult<{ id: number }>> {
  return runAcpAction(WEBHOOKS_ACP_SECTION, "edit", (actor) =>
    services().webhooks.save(actor, id, {
      name: field(fd, "name"),
      url: field(fd, "url"),
      format: field(fd, "format") === "discord" ? "discord" : "json",
      events: fd.getAll("event").filter((e): e is string => typeof e === "string"),
      enabled: field(fd, "enabled") === "on",
    }),
  );
}

export async function testWebhook(id: number): Promise<GcsResult<GcsWebhookDelivery>> {
  return runAcpAction(WEBHOOKS_ACP_SECTION, "edit", (actor) => services().webhooks.test(actor, id));
}

export async function rotateWebhookSecret(id: number): Promise<GcsResult<null>> {
  return runAcpAction(WEBHOOKS_ACP_SECTION, "edit", async (actor) => {
    await services().webhooks.rotateSecret(actor, id);
    return null;
  });
}

export async function deleteWebhook(id: number): Promise<GcsResult<null>> {
  return runAcpAction(WEBHOOKS_ACP_SECTION, "delete", async (actor) => {
    await services().webhooks.remove(actor, id);
    return null;
  });
}
