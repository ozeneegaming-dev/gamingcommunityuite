"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { UPLOAD_RULES } from "@/lib/ui-labels";
import { GcsUploadInput } from "@/lib/ui-inputs";
import { useUploadPost } from "@/lib/upload-request";

/** „Încarcă fișiere” în folderul deschis al bibliotecii: popupul sistemului, mai multe fișiere odată, cu progres. */
export function GcsMediaUpload({ folderId, maxMb }: { folderId: number | null; maxMb: number }) {
  const t = useTranslations("acp.pages.media");
  const post = useUploadPost();
  const router = useRouter();
  return (
    <GcsUploadInput
      title={t("upload")}
      multiple
      rules={{ ...UPLOAD_RULES.image(maxMb), accept: ["image/*", "video/*", "audio/*", "application/pdf", "application/zip", "font/*", ".woff", ".woff2", ".ttf", ".otf", ".zip", ".pdf", ".txt", ".cfg", ".json"], typesLabel: t("types"), image: {} }}
      uploadMany={async (files, onProgress) => {
        const fd = new FormData();
        for (const f of files) fd.append("file", f);
        if (folderId) fd.set("folderId", String(folderId));
        const res = await post<{ count: number }>("/api/pages/media", fd, onProgress);
        if (!res.ok) return res.error;
        router.refresh();
        return null;
      }}
      testId="gcs-acp-media-upload"
    />
  );
}
