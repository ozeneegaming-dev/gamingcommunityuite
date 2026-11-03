"use client";

import type { GcsErrorPayload, GcsResult } from "@gcs/core";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { GcsUploadInput } from "@/lib/ui-inputs";
import { UPLOAD_RULES } from "@/lib/ui-labels";
import { useUploadPost } from "@/lib/upload-request";
import { useErrorMessage } from "@/lib/use-error-message";

/**
 * Iconița aplicației instalabile: previzualizarea, încărcarea prin popupul sistemului (devine imediat setarea, prin
 * `/api/acp/pwa/icon`) și scoaterea (revine iconița implicită).
 */
export function GcsPwaIconField({ value, remove, labels }: { value: string; remove: () => Promise<GcsResult<null>>; labels: { title: string; hint: string; preview: string } }) {
  const router = useRouter();
  const message = useErrorMessage();
  const post = useUploadPost();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<GcsErrorPayload | null>(null);

  const upload = async (picked: File, onProgress: (fraction: number) => void): Promise<string | null> => {
    setError(null);
    const body = new FormData();
    body.set("file", picked);
    const res = await post<{ url: string }>("/api/acp/pwa/icon", body, onProgress);
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
    <div className="gcs-field" data-testid="gcs-pwa-icon">
      <span style={{ fontWeight: 600 }}>{labels.title}</span>
      <span className="gcs-field__hint">{labels.hint}</span>
      <GcsUploadInput
        title={labels.title}
        rules={UPLOAD_RULES.image(2)}
        current={value ? { url: value, name: labels.preview } : null}
        upload={upload}
        disabled={busy}
        {...(value ? { onRemove: () => void clear() } : {})}
        testId="gcs-pwa-icon-file"
      />
      {error && (
        <span role="alert" className="gcs-field__error">
          {message(error)}
        </span>
      )}
    </div>
  );
}
