"use client";

import type { GcsAssetStatus } from "@gcs/modules";
import type { GcsResult } from "@gcs/core";

/** O eroare a serverului (codul, câmpurile) sau a rețelei. */
export type GcsChunkError = { code: string; fields?: Record<string, string>; params?: Record<string, string> };

async function json<T>(res: Response): Promise<GcsResult<T>> {
  try {
    return (await res.json()) as GcsResult<T>;
  } catch {
    return { ok: false, error: { code: "network", status: res.status } } as GcsResult<T>;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Încarcă un fișier în Descărcări pe bucăți (sub limita cererilor): începe sesiunea, trimite bucățile în ordine (o
 * bucată eșuată se reîncearcă de 4 ori, cu pauză; după un răspuns pierdut serverul spune de unde continuă) și întoarce
 * id-ul fișierului. Progresul e partea trimisă (0–1).
 */
export async function uploadInChunks(
  file: File,
  target: { categoryId: number; fileId?: number | null },
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<{ ok: true; id: string } | { ok: false; error: GcsChunkError }> {
  const start = await json<{ id: string; chunkSize: number; received: number }>(
    await fetch("/api/downloads/uploads", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...target, name: file.name, size: file.size }), signal }).catch(
      () => new Response(null, { status: 0 }),
    ),
  );
  if (!start.ok) return { ok: false, error: start.error as GcsChunkError };
  const { id, chunkSize } = start.data;
  let offset = start.data.received;
  onProgress(file.size ? offset / file.size : 1);
  while (offset < file.size) {
    let attempt = 0;
    for (;;) {
      if (signal?.aborted) return { ok: false, error: { code: "aborted" } };
      const piece = file.slice(offset, Math.min(file.size, offset + chunkSize));
      const res = await fetch(`/api/downloads/uploads/${id}?offset=${offset}`, { method: "PUT", body: piece, signal }).catch(() => null);
      const body = res ? await json<{ received: number }>(res) : null;
      if (body?.ok) {
        offset = body.data.received;
        break;
      }
      // Offsetul nu se potrivește (un răspuns pierdut): serverul spune cât a primit.
      const received = body && !body.ok ? Number(body.error.params?.received) : Number.NaN;
      if (body && !body.ok && body.error.fields?.offset === "mismatch" && Number.isFinite(received)) {
        offset = received;
        break;
      }
      if (body && !body.ok && res && res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) return { ok: false, error: body.error as GcsChunkError };
      if (++attempt > 4) return { ok: false, error: { code: "network" } };
      await sleep(1000 * attempt);
    }
    onProgress(offset / file.size);
  }
  return { ok: true, id };
}

/** Starea fișierelor încărcate (verificarea tipului și antivirusul rulează după ultima bucată). */
export async function uploadStatus(ids: string[]): Promise<GcsAssetStatus[]> {
  if (ids.length === 0) return [];
  const res = await fetch("/api/downloads/status", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids }) }).catch(() => null);
  if (!res) return [];
  const body = await json<GcsAssetStatus[]>(res);
  return body.ok ? body.data : [];
}

export async function cancelUpload(id: string): Promise<void> {
  await fetch(`/api/downloads/uploads/${id}`, { method: "DELETE" }).catch(() => null);
}
