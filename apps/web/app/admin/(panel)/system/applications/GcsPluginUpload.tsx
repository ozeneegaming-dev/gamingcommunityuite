"use client";

import { useRouter } from "next/navigation";
import { GcsUploadInput } from "@/lib/ui-inputs";
import { UPLOAD_RULES } from "@/lib/ui-labels";
import { useUploadPost } from "@/lib/upload-request";

/** Arhiva pluginului: ZIP, cel mult 8 MB (`PLUGIN_ZIP_LIMITS.maxArchiveBytes`; serverul o verifică din nou). */
const RULES = UPLOAD_RULES.zip(8);

type Props = {
  /** `title` = titlul popupului („Alege arhiva pluginului (.zip)”), `hint` = nota de sub câmp. */
  labels: { title: string; hint: string };
};

/**
 * Încărcarea unei arhive de plugin (`.zip`) din popupul sistemului (tragere, alegere, verificările tipului și mărimii):
 * „Folosește” o trimite cu progres la `/api/acp/plugins/upload`, validată pe server (eroarea rămâne în popup), apoi
 * ecranul de confirmare cu raportul verificărilor. Nimic nu se instalează la acest pas.
 */
export function GcsPluginUpload({ labels }: Props) {
  const router = useRouter();
  const post = useUploadPost();

  async function upload(file: File, onProgress: (fraction: number) => void): Promise<string | null> {
    const fd = new FormData();
    fd.set("file", file);
    const res = await post<{ id: string }>("/api/acp/plugins/upload", fd, onProgress);
    if (!res.ok) return res.error;
    router.push(`/admin/system/applications/install/${res.data.id}`);
    return null;
  }

  return (
    <div className="gcs-pluginUpload">
      <GcsUploadInput title={labels.title} rules={RULES} upload={upload} testId="gcs-plugin-upload" />
      <small className="gcs-muted">{labels.hint}</small>
    </div>
  );
}
