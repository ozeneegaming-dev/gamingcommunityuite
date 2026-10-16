import type { GcsActor, GcsMemberRemovalService } from "@gcs/core";
import { writeZip } from "@gcs/plugin-sdk/zip";

/** Numele arhivei de export (fără diacritice și spații). */
export function gdprExportFileName(name: string, now = new Date()): string {
  const slug =
    name
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^A-Za-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "member";
  return `gdpr-${slug}-${now.toISOString().slice(0, 10)}.zip`;
}

/**
 * Exportul GDPR al datelor personale (Membri v2): arhiva ZIP cu un fișier JSON pe aplicație și `summary.json`
 * (`GcsMemberRemovalService.exportData`, cu dreptul pe Cereri GDPR și jurnalul).
 */
export async function gdprExportZip(removal: GcsMemberRemovalService, actor: GcsActor, userId: string): Promise<{ fileName: string; data: Buffer }> {
  const { user, files } = await removal.exportData(actor, userId);
  const entries = files.map((f) => ({ name: f.name, data: Buffer.from(JSON.stringify(f.data, null, 2), "utf8"), mode: 0o100644 }));
  return { fileName: gdprExportFileName(user.name), data: writeZip(entries) };
}
