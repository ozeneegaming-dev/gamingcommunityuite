"use server";

import type { GcsResult } from "@gcs/core";
import { API_ACP_SECTION } from "@gcs/modules";
import { field, runAcpAction } from "@/lib/acp-actions";
import { services } from "@/lib/services";

const scopes = (fd: FormData) => fd.getAll("scope").filter((s): s is string => typeof s === "string");

/** O cheie nouă; întoarce cheia întreagă, pe care pagina o arată o singură dată. */
export async function createApiKey(fd: FormData): Promise<GcsResult<{ id: number; key: string }>> {
  return runAcpAction(API_ACP_SECTION, "edit", (actor) => services().apiKeys.create(actor, field(fd, "name"), scopes(fd)));
}

export async function updateApiKey(id: number, fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(API_ACP_SECTION, "edit", async (actor) => {
    await services().apiKeys.update(actor, id, field(fd, "name"), scopes(fd));
    return null;
  });
}

export async function revokeApiKey(id: number): Promise<GcsResult<null>> {
  return runAcpAction(API_ACP_SECTION, "edit", async (actor) => {
    await services().apiKeys.revoke(actor, id);
    return null;
  });
}

export async function deleteApiKey(id: number): Promise<GcsResult<null>> {
  return runAcpAction(API_ACP_SECTION, "delete", async (actor) => {
    await services().apiKeys.remove(actor, id);
    return null;
  });
}
