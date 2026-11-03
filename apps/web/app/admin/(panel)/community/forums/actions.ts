"use server";

import { GcsValidationError, type GcsResult } from "@gcs/core";
import type { ForumType } from "@gcs/db";
import { FORUMS_ACP_SECTION, PREFIXES_ACP_SECTION, type GcsForumOrderItem } from "@gcs/modules";
import { field, intField, runAcpAction } from "@/lib/acp-actions";
import { forumExtOptions } from "@/lib/forum-ext-options";
import { safeModeActive } from "@/lib/plugins";
import { services } from "@/lib/services";

const TYPES: ForumType[] = ["CATEGORY", "FORUM", "QA", "LINK", "PAGE"];
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
        // Cardurile din grilă: imaginea de previzualizare (validată de serviciu: modul, fișierul forumului, focalizarea).
        ...(fd.has("previewMode")
          ? { preview: { mode: field(fd, "previewMode"), imageId: field(fd, "previewImageId") || null, focusX: intOr(fd, "previewFocusX", 50), focusY: intOr(fd, "previewFocusY", 50) } }
          : {}),
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

// ─── Forum v2: opțiunile, pagina unui nod PAGE, taburile extensiilor, notele ───────────────────────────────

/** Documentul editorului trimis ca JSON într-un câmp ascuns (`""` = gol). */
function docField(fd: FormData, name: string): unknown {
  const raw = field(fd, name);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new GcsValidationError({ [name]: "invalid" });
  }
}

const intOr = (fd: FormData, name: string, fallback: number) => {
  const v = intField(fd, name);
  return Number.isNaN(v) ? fallback : v;
};

export async function saveForumOptions(id: number, fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(FORUMS_ACP_SECTION, "edit", async (actor) => {
    const password = field(fd, "password");
    const removePassword = fd.get("removePassword") === "on";
    await services().forums.saveOptions(actor, id, {
      ownTopicsOnly: fd.get("ownTopicsOnly") === "on",
      ...(removePassword ? { password: "" } : password ? { password } : {}),
      rulesMode: (field(fd, "rulesMode") || "off") as "off" | "show" | "accept",
      ...(fd.has("rules") ? { rules: docField(fd, "rules") } : {}),
      defaultSort: field(fd, "defaultSort") || "last",
      pollsEnabled: fd.get("pollsEnabled") === "on",
      tagsEnabled: fd.get("tagsEnabled") === "on",
      countPosts: fd.get("countPosts") === "on",
      ratingEnabled: fd.get("ratingEnabled") === "on",
      minPosts: intOr(fd, "minPosts", 0),
      autoCloseDays: intOr(fd, "autoCloseDays", 0),
    });
    return null;
  });
}

export async function saveForumPage(id: number, fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(FORUMS_ACP_SECTION, "edit", async (actor) => {
    await services().forums.savePage(actor, id, {
      content: docField(fd, "content"),
      ctaLabel: field(fd, "ctaLabel"),
      ctaUrl: field(fd, "ctaUrl"),
      ctaIcon: field(fd, "ctaIcon") || null,
      allowTopics: fd.get("allowTopics") === "on",
      audienceGroupIds: fd.getAll("audience").map(Number).filter(Number.isSafeInteger),
    });
    return null;
  });
}

/** Un tab contribuit de o extensie (câmpurile declarate): valorile din formular, validate și salvate de nucleu. */
export async function saveForumExtensionTab(id: number, extension: string, tab: string, fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(FORUMS_ACP_SECTION, "edit", async (actor) => {
    const values: Record<string, unknown> = {};
    for (const [key, value] of fd.entries()) if (typeof value === "string" && !key.startsWith("$")) values[key] = value;
    const { db, forumSlots } = services();
    const plugins = !(await safeModeActive());
    const forum = await db.forum.findUnique({ where: { id }, select: { id: true, type: true } });
    // Valorile permise ale câmpurilor `select` cu `optionsFrom` (aceleași surse ca formularul).
    const view = forum ? (await forumSlots.editTabs(forum, { plugins })).find((x) => x.extension === extension && x.tab.key === tab) : undefined;
    const options = Object.fromEntries(Object.entries(await forumExtOptions(view?.tab.fields ?? [])).map(([k, list]) => [k, list.map((o) => o.value)]));
    await forumSlots.saveTab(actor, { forumId: id, extension, tab, values, options }, { plugins });
    return null;
  });
}

/** Resetează notele tuturor topicurilor forumului (în pagină, cu confirmarea). */
export async function resetForumRatings(id: number): Promise<GcsResult<null>> {
  return runAcpAction(FORUMS_ACP_SECTION, "delete", async (actor) => {
    await services().forums.resetRatings(actor, id);
    return null;
  });
}
