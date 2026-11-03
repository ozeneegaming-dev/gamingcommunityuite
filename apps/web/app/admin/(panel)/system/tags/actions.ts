"use server";

import type { GcsResult } from "@gcs/core";
import { TAGS_ACP_SECTION } from "@gcs/modules";
import { revalidatePath } from "next/cache";
import { field, intField, runAcpAction } from "@/lib/acp-actions";
import { services } from "@/lib/services";

export async function saveTagsConfig(fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(TAGS_ACP_SECTION, "edit", async (actor) => {
    await services().tagsAdmin.saveConfig(actor, { enabled: field(fd, "enabled") === "on", mode: field(fd, "mode") === "closed" ? "closed" : "open" });
    return null;
  });
}

export async function createTag(fd: FormData): Promise<GcsResult<{ id: number }>> {
  return runAcpAction(TAGS_ACP_SECTION, "edit", (actor) => services().tagsAdmin.create(actor, field(fd, "name")));
}

export async function renameTag(id: number, fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(TAGS_ACP_SECTION, "edit", async (actor) => {
    await services().tagsAdmin.rename(actor, id, field(fd, "name"));
    revalidatePath("/tags", "layout");
    return null;
  });
}

export async function mergeTag(id: number, fd: FormData): Promise<GcsResult<number>> {
  return runAcpAction(TAGS_ACP_SECTION, "edit", async (actor) => {
    const moved = await services().tagsAdmin.merge(actor, id, intField(fd, "intoId"));
    revalidatePath("/tags", "layout");
    return moved;
  });
}

export async function deleteTag(id: number): Promise<GcsResult<null>> {
  return runAcpAction(TAGS_ACP_SECTION, "delete", async (actor) => {
    await services().tagsAdmin.remove(actor, id);
    revalidatePath("/tags", "layout");
    return null;
  });
}

export async function pruneTags(): Promise<GcsResult<number>> {
  return runAcpAction(TAGS_ACP_SECTION, "delete", (actor) => services().tagsAdmin.pruneUnused(actor));
}
