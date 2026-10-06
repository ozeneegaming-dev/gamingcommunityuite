"use server";

import { GcsValidationError, type GcsResult } from "@gcs/core";
import type { ForumType } from "@gcs/db";
import { FORUMS_ACP_SECTION, PREFIXES_ACP_SECTION, type GcsForumOrderItem } from "@gcs/modules";
import { field, intField, runAcpAction } from "@/lib/acp-actions";
import { services } from "@/lib/services";

const TYPES: ForumType[] = ["CATEGORY", "FORUM", "QA", "LINK"];
const forumType = (v: string): ForumType => {
  if (!TYPES.includes(v as ForumType)) throw new GcsValidationError({ type: "invalid_type" });
  return v as ForumType;
};

export async function createForum(fd: FormData): Promise<GcsResult<{ id: number }>> {
  return runAcpAction(FORUMS_ACP_SECTION, "edit", async (actor) => {
    const parent = intField(fd, "parentId");
    const type = forumType(field(fd, "type"));
    const forum = await services().forums.create(
      {
        parentId: Number.isNaN(parent) ? null : parent,
        type,
        name: field(fd, "name"),
        icon: field(fd, "icon") || null,
        ...(type === "LINK" ? { linkUrl: field(fd, "linkUrl") } : {}),
      },
      actor,
    );
    return { id: forum.id };
  });
}

export async function reorderForums(items: GcsForumOrderItem[]): Promise<GcsResult<null>> {
  return runAcpAction(FORUMS_ACP_SECTION, "edit", async (actor) => {
    await services().forums.reorder(
      items.map((i) => ({ id: Number(i.id), parentId: i.parentId === null ? null : Number(i.parentId), position: Number(i.position) })),
      actor,
    );
    return null;
  });
}

export async function updateForum(id: number, fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(FORUMS_ACP_SECTION, "edit", async (actor) => {
    const type = field(fd, "type");
    await services().forums.update(
      id,
      {
        name: field(fd, "name"),
        description: field(fd, "description"),
        icon: field(fd, "icon") || null,
        color: field(fd, "color") || null,
        requireApproval: fd.get("requireApproval") === "on",
        ...(fd.has("subforumColumns") ? { subforumColumns: Number(field(fd, "subforumColumns")) } : {}),
        ...(type ? { type: forumType(type) } : {}),
        ...(fd.has("linkUrl") ? { linkUrl: field(fd, "linkUrl") } : {}),
      },
      actor,
    );
    return null;
  });
}

export async function setForumPrefixes(id: number, fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(FORUMS_ACP_SECTION, "edit", async (actor) => {
    await services().prefixes.setForumPrefixes(actor, id, fd.getAll("prefixId").map(Number).filter(Number.isSafeInteger));
    return null;
  });
}

export async function deleteForum(id: number, fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(FORUMS_ACP_SECTION, "delete", async (actor) => {
    const target = intField(fd, "moveContentTo");
    await services().forums.delete(id, Number.isNaN(target) ? {} : { moveContentTo: target }, actor);
    return null;
  });
}

export async function createPrefix(fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(PREFIXES_ACP_SECTION, "edit", async (actor) => {
    await services().prefixes.create(actor, { name: field(fd, "name"), color: field(fd, "color").toUpperCase() });
    return null;
  });
}

export async function updatePrefix(id: number, fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(PREFIXES_ACP_SECTION, "edit", async (actor) => {
    await services().prefixes.update(actor, id, { name: field(fd, "name"), color: field(fd, "color").toUpperCase() });
    return null;
  });
}

export async function deletePrefix(id: number): Promise<GcsResult<null>> {
  return runAcpAction(PREFIXES_ACP_SECTION, "delete", async (actor) => {
    await services().prefixes.delete(actor, id);
    return null;
  });
}

export async function reorderPrefixes(ids: number[]): Promise<GcsResult<null>> {
  return runAcpAction(PREFIXES_ACP_SECTION, "edit", async (actor) => {
    await services().prefixes.reorder(actor, ids.map(Number));
    return null;
  });
}
