"use client";

import type { GcsErrorPayload, GcsResult } from "@gcs/core";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { GcsUploadInput } from "@/lib/ui-inputs";
import { UPLOAD_RULES } from "@/lib/ui-labels";
import { useUploadPost } from "@/lib/upload-request";
import { useErrorMessage } from "@/lib/use-error-message";

type Labels = { title: string; hint: string; upload: string; replace: string; uploading: string; remove: string; preview: string };

/** Ce primește ruta (`/api/acp/seo/share-image`): imaginile pipeline-ului decorativ, cel mult 5 MB. */
const SHARE_IMAGE_RULES = UPLOAD_RULES.image(5);

/**
 * Imaginea de distribuire (OpenGraph / cardul X) în ACP → Promovare → SEO: previzualizarea, încărcarea prin popupul
 * sistemului (verificări, progres; devine imediat setarea, prin `/api/acp/seo/share-image`) și ștergerea. O adresă
 * externă se scrie în câmpul formularului de mai sus.
 */
export function GcsShareImageField({ value, remove, labels }: { value: string; remove: () => Promise<GcsResult<null>>; labels: Labels }) {
  const router = useRouter();
  const message = useErrorMessage();
  const post = useUploadPost();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<GcsErrorPayload | null>(null);

  const upload = async (picked: File, onProgress: (fraction: number) => void): Promise<string | null> => {
    setError(null);
    const body = new FormData();
    body.set("file", picked);
    const res = await post<{ url: string }>("/api/acp/seo/share-image", body, onProgress);
    if (!res.ok) return res.error;
    router.refresh();
    return null;
  };

  const clear = async () => {
    setBusy(true);
    setError(null);
    const result = await remove();
    setBusy(false);
    if (result.ok) router.refresh();
    else setError(result.error);
  };

  return (
    <div className="gcs-field" data-testid="gcs-seo-share-image">
      <span style={{ fontWeight: 600 }}>{labels.title}</span>
      <span className="gcs-muted" style={{ fontSize: 13 }}>
        {labels.hint}
      </span>
      <GcsUploadInput
        title={labels.title}
        rules={SHARE_IMAGE_RULES}
        current={value ? { url: value, name: labels.preview } : null}
        upload={upload}
        disabled={busy}
        {...(value ? { onRemove: () => void clear() } : {})}
        testId="gcs-seo-share-image-file"
        className="gcs-shareImage__upload"
      />
      {error && (
        <span role="alert" className="gcs-field__error">
          {message(error)}
        </span>
      )}
    </div>
  );
}
