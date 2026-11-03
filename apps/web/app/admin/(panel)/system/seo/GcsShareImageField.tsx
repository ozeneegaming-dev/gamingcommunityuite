"use client";

import type { GcsErrorPayload, GcsResult } from "@gcs/core";
import { GcsButton } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { useErrorMessage } from "@/lib/use-error-message";

type Labels = { title: string; hint: string; upload: string; replace: string; uploading: string; remove: string; preview: string };

/**
 * Imaginea de distribuire (OpenGraph / cardul X) în ACP → Promovare → SEO: previzualizarea, încărcarea (devine imediat
 * setarea, prin `/api/acp/seo/share-image`) și ștergerea. O adresă externă se scrie în câmpul formularului de mai sus.
 */
export function GcsShareImageField({ value, remove, labels }: { value: string; remove: () => Promise<GcsResult<null>>; labels: Labels }) {
  const router = useRouter();
  const message = useErrorMessage();
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<GcsErrorPayload | null>(null);

  const send = async (picked: File) => {
    setBusy(true);
    setError(null);
    const body = new FormData();
    body.set("file", picked);
    try {
      const res = await fetch("/api/acp/seo/share-image", { method: "POST", body });
      const result = (await res.json()) as GcsResult<{ url: string }>;
      if (result.ok) router.refresh();
      else setError(result.error);
    } catch {
      setError({ code: "network", status: 0 });
    } finally {
      setBusy(false);
      if (file.current) file.current.value = "";
    }
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
    <div className="gcs-extImage" data-testid="gcs-seo-share-image">
      <span className="gcs-extImage__preview" aria-hidden={value ? undefined : true}>
        {value ? <img src={value} alt={labels.preview} /> : <GcsIcon name="fa-regular fa-image" />}
      </span>
      <span className="gcs-extImage__tools">
        <span style={{ fontWeight: 600 }}>{labels.title}</span>
        <span className="gcs-muted" style={{ fontSize: 13 }}>
          {labels.hint}
        </span>
        <input
          ref={file}
          type="file"
          className="gcs-srOnly"
          accept="image/png,image/webp,image/gif,image/jpeg"
          onChange={(e) => {
            const picked = e.target.files?.[0];
            if (picked) void send(picked);
          }}
          data-testid="gcs-seo-share-image-file"
          tabIndex={-1}
        />
        <span style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <GcsButton type="button" variant="ghost" size="sm" loading={busy} disabled={busy} onClick={() => file.current?.click()} icon={<GcsIcon name="fa-solid fa-upload" />}>
            {busy ? labels.uploading : value ? labels.replace : labels.upload}
          </GcsButton>
          {value && (
            <GcsButton type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void clear()} icon={<GcsIcon name="fa-solid fa-xmark" />} data-testid="gcs-seo-share-image-remove">
              {labels.remove}
            </GcsButton>
          )}
        </span>
        {error && (
          <span role="alert" className="gcs-field__error">
            {message(error)}
          </span>
        )}
      </span>
    </div>
  );
}
