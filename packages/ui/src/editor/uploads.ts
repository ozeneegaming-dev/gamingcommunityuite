/** Răspunsul rutei de upload (`GcsResult<GcsAttachmentInfo>`), doar câmpurile folosite de editor. */
export type GcsUploaded = { id: string; url: string; filename: string; isImage: boolean; width: number | null; height: number | null };
type UploadResult = { ok: true; data: GcsUploaded } | { ok: false; error: { code: string; params?: Record<string, string> } };

/** Încarcă un fișier pentru postare. Aruncă un `Error` cu codul de eroare (ex. `validation`, `rate_limited`). */
export async function uploadFile(url: string, forumId: number, file: File): Promise<GcsUploaded> {
  const form = new FormData();
  form.set("file", file);
  form.set("forumId", String(forumId));
  const res = await fetch(url, { method: "POST", body: form, credentials: "same-origin" });
  const body = (await res.json().catch(() => null)) as UploadResult | null;
  if (!body) throw new Error("network");
  if (!body.ok) throw new Error(body.error.code);
  return body.data;
}
