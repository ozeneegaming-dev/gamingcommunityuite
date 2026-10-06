/** Răspunsul rutei de upload (`GcsResult<GcsAttachmentInfo>`), doar câmpurile folosite de editor. */
export type GcsUploaded = { id: string; url: string; filename: string; isImage: boolean; width: number | null; height: number | null };
type UploadResult = { ok: true; data: GcsUploaded } | { ok: false; error: { code: string; params?: Record<string, string> } };

/**
 * Încarcă un fișier pentru postare, cu progresul trimiterii (0–100) prin `onProgress`.
 * Aruncă un `Error` cu codul de eroare (ex. `validation`, `rate_limited`).
 */
export function uploadFile(url: string, forumId: number, file: File, onProgress?: (percent: number) => void): Promise<GcsUploaded> {
  const form = new FormData();
  form.set("file", file);
  form.set("forumId", String(forumId));
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onerror = () => reject(new Error("network"));
    xhr.onload = () => {
      let body: UploadResult | null = null;
      try {
        body = JSON.parse(xhr.responseText) as UploadResult;
      } catch {
        body = null;
      }
      if (!body) return reject(new Error("network"));
      if (!body.ok) return reject(new Error(body.error.code));
      onProgress?.(100);
      resolve(body.data);
    };
    xhr.send(form);
  });
}
