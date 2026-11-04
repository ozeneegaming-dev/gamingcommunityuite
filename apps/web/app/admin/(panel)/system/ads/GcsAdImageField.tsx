"use client";

import { useState } from "react";
import { GcsUploadInput } from "@/lib/ui-inputs";
import { UPLOAD_RULES } from "@/lib/ui-labels";
import { useUploadPost } from "@/lib/upload-request";

/**
 * Imaginea reclamei: încărcarea prin popupul sistemului (`/api/acp/ads/image`) pune adresa în câmpul ascuns `imageUrl`,
 * salvat cu formularul; „Scoate” golește câmpul. O adresă https externă se poate scrie în câmpul de alături.
 */
export function GcsAdImageField({ value, title, preview }: { value: string; title: string; preview: string }) {
  const post = useUploadPost();
  const [url, setUrl] = useState(value);
  const upload = async (picked: File, onProgress: (fraction: number) => void): Promise<string | null> => {
    const body = new FormData();
    body.set("file", picked);
    const res = await post<{ url: string }>("/api/acp/ads/image", body, onProgress);
    if (!res.ok) return res.error;
    setUrl(res.data.url);
    return null;
  };
  return (
    <div className="gcs-field" data-testid="gcs-ad-image">
      <span>{title}</span>
      <GcsUploadInput title={title} rules={UPLOAD_RULES.image(3)} current={url ? { url, name: preview } : null} upload={upload} {...(url ? { onRemove: () => setUrl("") } : {})} testId="gcs-ad-image-file" />
      <input className="gcs-input" name="imageUrl" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" aria-label={title} data-testid="gcs-ad-image-url" />
    </div>
  );
}
