"use client";

import type { GcsErrorPayload, GcsResult } from "@gcs/core";
import { useTranslations } from "next-intl";
import { useErrorMessage } from "./use-error-message";

/**
 * Trimite un formular cu fișiere prin XHR, ca popupul de încărcare să arate progresul real (`upload.onprogress`, 0–1).
 * Rutele răspund cu `GcsResult`; un răspuns care nu e JSON (proxy, limită de mărime) sau o eroare de rețea devin
 * `{ ok: false, error: { code: "network" } }`.
 */
export function postWithProgress<T>(url: string, body: FormData, onProgress?: (fraction: number) => void): Promise<GcsResult<T>> {
  const failed = (status: number): GcsResult<T> => ({ ok: false, error: { code: "network", status } });
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgress?.(Math.min(1, e.loaded / e.total));
    };
    xhr.onerror = () => resolve(failed(0));
    xhr.onload = () => {
      try {
        const res = JSON.parse(xhr.responseText) as GcsResult<T>;
        if (res && typeof res === "object" && "ok" in res) {
          if (res.ok) onProgress?.(1);
          return resolve(res);
        }
      } catch {
        /* răspunsul nu e JSON */
      }
      resolve(failed(xhr.status));
    };
    xhr.send(body);
  });
}

/**
 * Încărcarea din popupul sistemului (`upload` al `GcsUploadInput`): trimite formularul cu progres și întoarce datele
 * rutei sau textul erorii (tradus; „Încărcarea n-a reușit” la rețea), gata de arătat în popup.
 */
export function useUploadPost() {
  const message = useErrorMessage();
  const t = useTranslations("ui.upload");
  const text = (error: GcsErrorPayload) => (error.code === "network" ? t("errUpload") : message(error) || t("errUpload"));
  return async function post<T>(url: string, body: FormData, onProgress?: (fraction: number) => void): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
    const res = await postWithProgress<T>(url, body, onProgress);
    return res.ok ? { ok: true, data: res.data } : { ok: false, error: text(res.error) };
  };
}
