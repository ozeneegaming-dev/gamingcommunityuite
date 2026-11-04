"use server";

import { GcsValidationError, settingValueError, type GcsResult } from "@gcs/core";
import { PAGES_ACP, PAGES_PRESETS, PAGES_SETTINGS, type GcsPagesPreset } from "@gcs/modules";
import { getTranslations } from "next-intl/server";
import { field, intField, runAcpAction } from "@/lib/acp-actions";
import { services } from "@/lib/services";

const ints = (fd: FormData, name: string) => fd.getAll(name).map(Number).filter((n) => Number.isSafeInteger(n) && n > 0);
const optionalId = (fd: FormData, name: string): number | null => {
  const n = intField(fd, name);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};
const on = (fd: FormData, name: string) => fd.get(name) === "on";
function json(fd: FormData, name: string): unknown {
  const raw = field(fd, name);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new GcsValidationError({ [name]: "invalid" });
  }
}

// ─── Arborele ──────────────────────────────────────────────────────────────────────────────────────────────

/** Folderul sau pagina (panoul din ACP › Pagini): detaliile, accesul, SEO și meniul. */
export async function savePagesNode(id: number | null, fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(PAGES_ACP.pages, "edit", async (actor) => {
    const kind = field(fd, "kind") === "folder" ? "folder" : "page";
    const contentType = field(fd, "contentType");
    await services().pagesAdmin.saveNode(actor, id, {
      kind,
      parentId: optionalId(fd, "parentId"),
      title: field(fd, "title"),
      slug: field(fd, "slug"),
      icon: field(fd, "icon") || null,
      contentType: contentType === "database" || contentType === "html" ? contentType : "layout",
      databaseId: optionalId(fd, "databaseId"),
      published: on(fd, "published"),
      showTitle: on(fd, "showTitle"),
      viewGroupIds: ints(fd, "viewGroups"),
      homeGroupIds: ints(fd, "homeGroups"),
      seoTitle: field(fd, "seoTitle"),
      seoDescription: field(fd, "seoDescription"),
      seoMediaId: optionalId(fd, "seoMediaId"),
      noindex: on(fd, "noindex"),
      inMenu: on(fd, "inMenu"),
    });
    return null;
  });
}

export async function deletePagesNode(id: number): Promise<GcsResult<null>> {
  return runAcpAction(PAGES_ACP.pages, "delete", async (actor) => {
    await services().pagesAdmin.deleteNode(actor, id);
    return null;
  });
}

export async function duplicatePagesNode(id: number): Promise<GcsResult<null>> {
  return runAcpAction(PAGES_ACP.pages, "edit", async (actor) => {
    await services().pagesAdmin.duplicate(actor, id);
    return null;
  });
}

/** „Pagina de pornire” a aplicației (pentru toți; grupurile au opțiunea lor în panoul paginii). */
export async function setPagesHome(id: number): Promise<GcsResult<null>> {
  return runAcpAction(PAGES_ACP.settings, "edit", async (actor) => {
    const { settings } = services();
    const current = await settings.get<number>("pages.home_page");
    await settings.set("pages.home_page", current === id ? 0 : id, actor);
    return null;
  });
}

export async function reorderPagesNodes(parentId: number | null, ids: number[]): Promise<GcsResult<null>> {
  return runAcpAction(PAGES_ACP.pages, "edit", async (actor) => {
    await services().pagesAdmin.reorder(actor, parentId, ids.map(Number));
    return null;
  });
}

/** Constructorul: layout-ul întreg (secțiunile, coloanele, blocurile). Erorile vin pe bloc. */
export async function savePagesLayout(id: number, layout: unknown): Promise<GcsResult<null>> {
  return runAcpAction(PAGES_ACP.pages, "edit", async (actor) => {
    await services().pagesAdmin.saveLayout(actor, id, layout);
    return null;
  });
}

export async function savePagesHtml(id: number, html: string): Promise<GcsResult<null>> {
  return runAcpAction(PAGES_ACP.pages, "edit", async (actor) => {
    await services().pagesAdmin.saveHtml(actor, id, typeof html === "string" ? html : "");
    return null;
  });
}

export async function restorePagesRevision(revisionId: number): Promise<GcsResult<null>> {
  return runAcpAction(PAGES_ACP.pages, "edit", async (actor) => {
    await services().pagesAdmin.restoreRevision(actor, revisionId);
    return null;
  });
}

// ─── Blocurile ─────────────────────────────────────────────────────────────────────────────────────────────

export async function savePagesBlock(id: number | null, fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(PAGES_ACP.pages, "edit", async (actor) => {
    const kind = field(fd, "kind");
    const fields = json(fd, "fields") ?? [];
    const values: Record<string, unknown> = {};
    for (const [k, v] of fd.entries()) if (k.startsWith("value.") && typeof v === "string") values[k.slice(6)] = v;
    await services().pagesAdmin.saveBlock(actor, id, {
      key: field(fd, "key"),
      name: field(fd, "name"),
      description: field(fd, "description"),
      category: field(fd, "category"),
      kind,
      content: json(fd, "content"),
      html: field(fd, "html"),
      fields,
      values,
    });
    return null;
  });
}

export async function deletePagesBlock(id: number): Promise<GcsResult<null>> {
  return runAcpAction(PAGES_ACP.pages, "delete", async (actor) => {
    await services().pagesAdmin.deleteBlock(actor, id);
    return null;
  });
}

// ─── Bazele de date ────────────────────────────────────────────────────────────────────────────────────────

/** „Creează din șablon”: baza, câmpurile, categoriile și pagina ei, cu textele șablonului în limba site-ului. */
export async function createPagesDatabase(fd: FormData): Promise<GcsResult<{ id: number }>> {
  return runAcpAction(PAGES_ACP.databases, "edit", async (actor) => {
    const preset = field(fd, "preset") as GcsPagesPreset;
    if (!PAGES_PRESETS.includes(preset)) throw new GcsValidationError({ preset: "invalid_choice" });
    const locale = await services().settings.get<string>("site.locale");
    const t = await getTranslations({ locale: locale || "ro", namespace: `pages.presets.${preset}` });
    const res = await services().pagesAdmin.createFromPreset(actor, preset, (k) => (t.has(k as never) ? t(k as never) : ""), { parentId: optionalId(fd, "parentId"), name: field(fd, "name") });
    return { id: res.databaseId };
  });
}

/** Importă pachetul unei baze (fișierul `.json` descărcat). */
export async function importPagesDatabase(fd: FormData): Promise<GcsResult<{ id: number }>> {
  return runAcpAction(PAGES_ACP.databases, "edit", async (actor) => {
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) throw new GcsValidationError({ file: "required" });
    if (file.size > 20 * 1024 * 1024) throw new GcsValidationError({ file: "too_large" });
    let pkg: unknown;
    try {
      pkg = JSON.parse(await file.text());
    } catch {
      throw new GcsValidationError({ file: "invalid_package" });
    }
    const res = await services().pagesAdmin.importDatabase(actor, pkg, { parentId: optionalId(fd, "parentId") });
    return { id: res.databaseId };
  });
}

/** Detaliile, aspectul, funcțiile și permisiunile unei baze de date (tab-urile paginii ei din ACP). */
export async function savePagesDatabase(id: number, fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(PAGES_ACP.databases, "edit", async (actor) => {
    const flag = (name: string) => (fd.has(`has.${name}`) ? on(fd, name) : undefined);
    const groups = (name: string) => (fd.has(`has.${name}`) ? ints(fd, name) : undefined);
    const perPage = intField(fd, "perPage");
    await services().pagesAdmin.saveDatabase(actor, id, {
      name: field(fd, "name"),
      ...(fd.has("key") ? { key: field(fd, "key") } : {}),
      ...(fd.has("description") ? { description: field(fd, "description") } : {}),
      ...(fd.has("icon") ? { icon: field(fd, "icon") || null } : {}),
      ...(fd.has("recordLabel") ? { recordLabel: field(fd, "recordLabel") } : {}),
      ...(fd.has("recordPlural") ? { recordPlural: field(fd, "recordPlural") } : {}),
      ...(fd.has("listLayout") ? { listLayout: field(fd, "listLayout") } : {}),
      ...(fd.has("sort") ? { sort: field(fd, "sort") } : {}),
      ...(fd.has("indexMode") ? { indexMode: field(fd, "indexMode") } : {}),
      ...(Number.isInteger(perPage) ? { perPage } : {}),
      ...(fd.has("forumId") ? { forumId: optionalId(fd, "forumId") } : {}),
      ...(fd.has("fields") ? { fields: json(fd, "fields") ?? [] } : {}),
      comments: flag("comments"),
      ratings: flag("ratings"),
      submissions: flag("submissions"),
      approval: flag("approval"),
      authorEdit: flag("authorEdit"),
      searchable: flag("searchable"),
      inStream: flag("inStream"),
      useCategories: flag("useCategories"),
      commentApproval: flag("commentApproval"),
      recordImage: flag("recordImage"),
      rss: flag("rss"),
      wiki: flag("wiki"),
      revisions: flag("revisions"),
      viewGroupIds: groups("viewGroups"),
      submitGroupIds: groups("submitGroups"),
      commentGroupIds: groups("commentGroups"),
      rateGroupIds: groups("rateGroups"),
    });
    return null;
  });
}

export async function deletePagesDatabase(id: number): Promise<GcsResult<null>> {
  return runAcpAction(PAGES_ACP.databases, "delete", async (actor) => {
    await services().pagesAdmin.deleteDatabase(actor, id);
    return null;
  });
}

export async function savePagesCategory(databaseId: number, id: number | null, fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(PAGES_ACP.databases, "edit", async (actor) => {
    await services().pagesAdmin.saveCategory(actor, databaseId, id, {
      name: field(fd, "name"),
      slug: field(fd, "slug"),
      description: field(fd, "description"),
      icon: field(fd, "icon") || null,
      color: field(fd, "color") || null,
      parentId: optionalId(fd, "parentId"),
      mediaId: optionalId(fd, "mediaId"),
      viewGroupIds: ints(fd, "viewGroups"),
      private: on(fd, "private"),
    });
    return null;
  });
}

export async function deletePagesCategory(databaseId: number, id: number): Promise<GcsResult<null>> {
  return runAcpAction(PAGES_ACP.databases, "delete", async (actor) => {
    await services().pagesAdmin.deleteCategory(actor, databaseId, id);
    return null;
  });
}

export async function reorderPagesCategories(databaseId: number, ids: number[]): Promise<GcsResult<null>> {
  return runAcpAction(PAGES_ACP.databases, "edit", async (actor) => {
    await services().pagesAdmin.reorderCategories(actor, databaseId, ids.map(Number));
    return null;
  });
}

// ─── Înregistrările (coada din ACP) ────────────────────────────────────────────────────────────────────────

export async function bulkPagesRecords(fd: FormData): Promise<GcsResult<{ done: number }>> {
  return runAcpAction(PAGES_ACP.records, "edit", async (actor) => {
    const action = field(fd, "action");
    if (!["approve", "reject", "hide", "unhide", "delete"].includes(action)) throw new GcsValidationError({ action: "invalid_choice" });
    const done = await services().pagesRecords.bulk(actor, ints(fd, "ids"), action as "approve", field(fd, "reason"));
    return { done };
  });
}

export async function moderatePagesCommentAcp(commentId: number, action: "approve" | "delete"): Promise<GcsResult<null>> {
  return runAcpAction(PAGES_ACP.records, "edit", async (actor) => {
    if (action === "approve") await services().pagesRecords.approveComment(actor, commentId);
    else await services().pagesRecords.deleteComment(actor, commentId);
    return null;
  });
}

// ─── Media ─────────────────────────────────────────────────────────────────────────────────────────────────

export async function savePagesMediaItem(id: number, fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(PAGES_ACP.media, "edit", async (actor) => {
    await services().pagesAdmin.saveMedia(actor, id, { title: field(fd, "title"), alt: field(fd, "alt"), folderId: optionalId(fd, "folderId") });
    return null;
  });
}

export async function deletePagesMedia(ids: number[]): Promise<GcsResult<{ count: number }>> {
  return runAcpAction(PAGES_ACP.media, "delete", async (actor) => ({ count: await services().pagesAdmin.deleteMedia(actor, ids.map(Number)) }));
}

export async function movePagesMedia(ids: number[], folderId: number | null): Promise<GcsResult<null>> {
  return runAcpAction(PAGES_ACP.media, "edit", async (actor) => {
    await services().pagesAdmin.moveMedia(actor, ids.map(Number), folderId);
    return null;
  });
}

export async function savePagesMediaFolder(id: number | null, fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(PAGES_ACP.media, "edit", async (actor) => {
    await services().pagesAdmin.saveFolder(actor, id, { name: field(fd, "name"), parentId: optionalId(fd, "parentId") });
    return null;
  });
}

export async function deletePagesMediaFolder(id: number): Promise<GcsResult<null>> {
  return runAcpAction(PAGES_ACP.media, "delete", async (actor) => {
    await services().pagesAdmin.deleteFolder(actor, id);
    return null;
  });
}

// ─── Setările ──────────────────────────────────────────────────────────────────────────────────────────────

/** Setările aplicației (ACP › Pagini › Setări): doar cele schimbate, fiecare validată după definiția ei. */
export async function savePagesSettings(fd: FormData): Promise<GcsResult<null>> {
  return runAcpAction(PAGES_ACP.settings, "edit", async (actor) => {
    const { settings } = services();
    const errors: Record<string, string> = {};
    const changes: [string, unknown][] = [];
    for (const def of PAGES_SETTINGS) {
      if (!fd.has(def.key) && def.type !== "boolean") continue;
      if (def.type === "boolean" && !fd.has(`has.${def.key}`)) continue;
      const value = def.type === "boolean" ? fd.get(def.key) === "on" : def.type === "number" ? intField(fd, def.key) : field(fd, def.key);
      const error = settingValueError(def, value);
      if (error) errors[def.key] = error;
      else if (JSON.stringify(await settings.get(def.key)) !== JSON.stringify(value)) changes.push([def.key, value]);
    }
    if (Object.keys(errors).length > 0) throw new GcsValidationError(errors);
    for (const [k, v] of changes) await settings.set(k, v, actor);
    return null;
  });
}
