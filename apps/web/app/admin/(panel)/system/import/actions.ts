"use server";

import type { GcsResult } from "@gcs/core";
import { IMPORT_ACP_SECTION, type GcsImportLogView, type GcsImportView, type GcsRedirectConfig } from "@gcs/modules";
import { field, intField, runAcpAction } from "@/lib/acp-actions";
import { services } from "@/lib/services";

export type GcsImportState = { job: GcsImportView | null; logs: GcsImportLogView[]; errors: GcsImportLogView[] };

/** Starea curentă a unui import (polling-ul paginii): jobul, ultimele rânduri din jurnal și ultimele erori. */
export async function importStatusAction(id: string): Promise<GcsResult<GcsImportState>> {
  return runAcpAction(IMPORT_ACP_SECTION, "view", async (actor) => {
    const { importer } = services();
    const job = await importer.get(actor, String(id));
    const [logs, errors] = await Promise.all([importer.logs(actor, job.id, { limit: 30 }), importer.logs(actor, job.id, { level: "error", limit: 30 })]);
    return { job, logs, errors };
  });
}

/** Salvează conexiunea și o testează: schema, versiunea și numerele pe tip (pasul 1 al asistentului). */
export async function saveAndTestImportAction(fd: FormData): Promise<GcsResult<GcsImportView>> {
  return runAcpAction(IMPORT_ACP_SECTION, "edit", async (actor) => {
    const { importer } = services();
    const id = field(fd, "id") || undefined;
    const filesMode = field(fd, "filesMode");
    const saved = await importer.saveConfig(
      actor,
      {
        host: field(fd, "host"),
        port: intField(fd, "port"),
        database: field(fd, "database"),
        user: field(fd, "user"),
        password: field(fd, "password"),
        prefix: field(fd, "prefix"),
        filesMode: filesMode === "folder" || filesMode === "url" ? filesMode : "none",
        filesPath: filesMode === "url" ? field(fd, "filesUrl") : field(fd, "filesPath"),
        oldUrl: field(fd, "oldUrl"),
      },
      id,
    );
    return importer.testConnection(actor, saved.id);
  });
}

export async function startImportAction(id: string, opts: { dryRun: boolean; options: string[]; redirects: boolean }): Promise<GcsResult<GcsImportView>> {
  return runAcpAction(IMPORT_ACP_SECTION, "edit", (actor) =>
    services().importer.start(actor, String(id), {
      dryRun: opts.dryRun === true,
      options: Array.isArray(opts.options) ? opts.options.map(String) : [],
      redirects: opts.redirects === true,
    }),
  );
}

export async function controlImportAction(id: string, action: "pause" | "resume" | "cancel"): Promise<GcsResult<GcsImportView>> {
  return runAcpAction(IMPORT_ACP_SECTION, "edit", (actor) => {
    const { importer } = services();
    if (action === "pause") return importer.pause(actor, String(id));
    if (action === "resume") return importer.resume(actor, String(id));
    return importer.cancel(actor, String(id));
  });
}

export async function deleteImportCredentialsAction(id: string): Promise<GcsResult<GcsImportView>> {
  return runAcpAction(IMPORT_ACP_SECTION, "edit", (actor) => services().importer.deleteCredentials(actor, String(id)));
}

export async function deleteImportAction(id: string): Promise<GcsResult<null>> {
  return runAcpAction(IMPORT_ACP_SECTION, "delete", async (actor) => {
    await services().importer.delete(actor, String(id));
    return null;
  });
}

export async function setImportRedirectsAction(id: string, enabled: boolean, prefix: string): Promise<GcsResult<GcsRedirectConfig>> {
  return runAcpAction(IMPORT_ACP_SECTION, "edit", (actor) => services().importer.setRedirects(actor, String(id), enabled === true, String(prefix ?? "")));
}

export async function checkImportRedirectAction(url: string): Promise<GcsResult<{ from: string; to: string | null }>> {
  return runAcpAction(IMPORT_ACP_SECTION, "view", (actor) => services().importer.checkRedirect(actor, String(url).slice(0, 2000)));
}
