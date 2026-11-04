"use server";

import { DOWNLOAD_SETTINGS, DOWNLOADS_ACP, type GcsCategoryInput } from "@gcs/modules";
import { revalidatePath } from "next/cache";
import { field, intField, runAcpAction } from "@/lib/acp-actions";
import { services } from "@/lib/services";

const dl = () => services().downloads;
const done = () => {
  revalidatePath("/downloads", "layout");
  revalidatePath("/admin/community/downloads", "layout");
};
const bool = (fd: FormData, name: string) => fd.get(name) === "on" || fd.get(name) === "1" || fd.get(name) === "true";
const ints = (fd: FormData, name: string) => fd.getAll(name).map((v) => Number(v)).filter((n) => Number.isInteger(n) && n > 0);
const doc = (raw: string): unknown => {
  if (!raw) return "";
  try {
    return JSON.parse(raw);
  } catch {
    return "";
  }
};

/** Formularul unei categorii (toate tab-urile): datele de bază și opțiunile (`opt:<cheie>`). */
function categoryInput(fd: FormData): GcsCategoryInput {
  const parent = intField(fd, "parentId");
  const clan = intField(fd, "clanId");
  const maxMb = field(fd, "opt:maxFileMb").trim();
  const num = (k: string, d: number) => {
    const n = intField(fd, `opt:${k}`);
    return Number.isNaN(n) ? d : n;
  };
  const text = (k: string) => field(fd, `opt:${k}`);
  const anyExt = bool(fd, "opt:anyExtension");
  return {
    name: field(fd, "name"),
    description: doc(field(fd, "description")),
    parentId: parent > 0 ? parent : null,
    icon: field(fd, "icon"),
    iconId: field(fd, "iconId") || null,
    coverId: field(fd, "coverId") || null,
    enabled: bool(fd, "enabled"),
    vipOnly: bool(fd, "vipOnly"),
    clanId: clan > 0 ? clan : null,
    fieldIds: ints(fd, "fieldIds"),
    options: {
      comments: bool(fd, "opt:comments"),
      commentsApproval: bool(fd, "opt:commentsApproval"),
      reviews: bool(fd, "opt:reviews"),
      reviewNeedsDownload: bool(fd, "opt:reviewNeedsDownload"),
      reviewsApproval: bool(fd, "opt:reviewsApproval"),
      sort: text("sort"),
      extensions: anyExt ? [] : text("extensions").split(/[\s,;]+/).filter(Boolean),
      maxFileMb: maxMb === "" ? null : Number(maxMb),
      multipleFiles: bool(fd, "opt:multipleFiles"),
      versioning: text("versioning"),
      keepVersions: bool(fd, "opt:keepVersions"),
      versionsToKeep: num("versionsToKeep", 0),
      requireChangelog: bool(fd, "opt:requireChangelog"),
      approval: bool(fd, "opt:approval"),
      screenshots: bool(fd, "opt:screenshots"),
      requireScreenshots: bool(fd, "opt:requireScreenshots"),
      screenshotMaxKb: num("screenshotMaxKb", 0),
      maxScreenshots: num("maxScreenshots", 8),
      tags: bool(fd, "opt:tags"),
      terms: text("terms"),
      termsWhen: text("termsWhen"),
      submitTerms: text("submitTerms"),
      cannotView: text("cannotView"),
      cannotDownload: text("cannotDownload"),
      logDownloads: bool(fd, "opt:logDownloads"),
      logDays: num("logDays", 0),
      authorSeesLog: bool(fd, "opt:authorSeesLog"),
      forumTopic: {
        enabled: bool(fd, "opt:topicEnabled"),
        forumId: num("topicForumId", 0),
        prefix: text("topicPrefix"),
        suffix: text("topicSuffix"),
        deleteWithFile: bool(fd, "opt:topicDelete"),
        screenshot: bool(fd, "opt:topicScreenshot"),
      },
    },
  };
}

export async function saveCategory(id: number | null, fd: FormData) {
  return runAcpAction(DOWNLOADS_ACP.categories, "edit", async (actor) => {
    const input = categoryInput(fd);
    const out = id === null ? await dl().admin.createCategory(actor, input) : (await dl().admin.updateCategory(actor, id, input), id);
    done();
    return out;
  });
}

export async function copyCategory(id: number, fd: FormData) {
  return runAcpAction(DOWNLOADS_ACP.categories, "edit", async (actor) => {
    const out = await dl().admin.copyCategory(actor, id, field(fd, "name"));
    done();
    return out;
  });
}

export async function deleteCategory(id: number, fd: FormData) {
  return runAcpAction(DOWNLOADS_ACP.categories, "delete", async (actor) => {
    const move = intField(fd, "moveTo");
    await dl().admin.deleteCategory(actor, id, { moveTo: move > 0 ? move : null, deleteContent: field(fd, "content") === "delete" });
    done();
  });
}

export async function reorderCategories(parentId: number | null, ids: number[]) {
  return runAcpAction(DOWNLOADS_ACP.categories, "edit", async (actor) => {
    await dl().admin.reorderCategories(actor, parentId, ids);
    done();
  });
}

export async function saveField(id: number | null, fd: FormData) {
  return runAcpAction(DOWNLOADS_ACP.fields, "edit", async (actor) => {
    const out = await dl().admin.saveField(actor, id, {
      name: field(fd, "name"),
      description: field(fd, "description"),
      type: field(fd, "type"),
      options: field(fd, "options").split("\n").map((o) => o.trim()).filter(Boolean),
      multiple: bool(fd, "multiple"),
      required: bool(fd, "required"),
      location: field(fd, "location"),
      inTopic: bool(fd, "inTopic"),
      topicFormat: field(fd, "topicFormat"),
      viewGroups: ints(fd, "viewGroups"),
      editGroups: ints(fd, "editGroups"),
      categoryIds: ints(fd, "categoryIds"),
    });
    done();
    return out;
  });
}

export async function deleteField(id: number) {
  return runAcpAction(DOWNLOADS_ACP.fields, "delete", async (actor) => {
    await dl().admin.deleteField(actor, id);
    done();
  });
}

export async function reorderFields(ids: number[]) {
  return runAcpAction(DOWNLOADS_ACP.fields, "edit", async (actor) => {
    await dl().admin.reorderFields(actor, ids);
    done();
  });
}

/** Setările trimise ca `setting:<cheie>` (doar cele din formularul tab-ului); tipurile după definiții. */
function settingValues(fd: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const present = new Set([...fd.keys()].filter((k) => k.startsWith("setting:") || k.startsWith("present:")).map((k) => k.replace(/^(setting|present):/, "")));
  for (const def of DOWNLOAD_SETTINGS) {
    if (!present.has(def.key)) continue;
    const name = `setting:${def.key}`;
    if (def.type === "boolean") out[def.key] = bool(fd, name);
    else if (def.type === "number") out[def.key] = Number(field(fd, name));
    else if (def.type === "json") out[def.key] = ints(fd, name);
    else out[def.key] = field(fd, name);
  }
  return out;
}

export async function saveDownloadSettings(section: "settings" | "antivirus", fd: FormData) {
  const key = section === "settings" ? DOWNLOADS_ACP.settings : DOWNLOADS_ACP.antivirus;
  return runAcpAction(key, "edit", async (actor) => {
    await dl().admin.saveSettings(actor, key, settingValues(fd));
    done();
  });
}

export async function approveVersion(versionId: number) {
  return runAcpAction(DOWNLOADS_ACP.queue, "edit", async (actor) => {
    await dl().service.approve(actor, versionId);
    done();
  });
}

export async function rejectVersion(versionId: number, fd: FormData) {
  return runAcpAction(DOWNLOADS_ACP.queue, "edit", async (actor) => {
    await dl().service.reject(actor, versionId, field(fd, "reason"));
    done();
  });
}

export async function setFileFlags(fileId: number, flags: { featured?: boolean; hidden?: boolean }) {
  return runAcpAction(DOWNLOADS_ACP.files, "edit", async (actor) => {
    await dl().service.setFlags(actor, fileId, flags);
    done();
  });
}

export async function deleteFile(fileId: number) {
  return runAcpAction(DOWNLOADS_ACP.files, "delete", async (actor) => {
    await dl().service.remove(actor, fileId);
    done();
  });
}

export async function testAntivirus() {
  return runAcpAction(DOWNLOADS_ACP.antivirus, "view", async (actor) => dl().admin.testScanner(actor));
}

export async function rescanNow() {
  return runAcpAction(DOWNLOADS_ACP.antivirus, "edit", async (actor) => {
    await dl().admin.rescanNow(actor);
  });
}

export async function releaseQuarantined(assetId: string) {
  return runAcpAction(DOWNLOADS_ACP.antivirus, "edit", async (actor) => {
    await dl().service.releaseQuarantine(actor, assetId);
    done();
  });
}

export async function deleteQuarantined(assetId: string) {
  return runAcpAction(DOWNLOADS_ACP.antivirus, "delete", async (actor) => {
    await dl().admin.deleteQuarantined(actor, assetId);
    done();
  });
}
