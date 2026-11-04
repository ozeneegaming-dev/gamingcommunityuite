"use client";

import { faArrowDown, faArrowUp, faFlask, faRotate } from "@fortawesome/free-solid-svg-icons";
import { GcsButton, GcsIconSvg } from "@gcs/ui";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { GcsUploadInput } from "@/lib/ui-inputs";
import { UPLOAD_RULES } from "@/lib/ui-labels";
import { useUploadPost } from "@/lib/upload-request";
import { useErrorMessage } from "@/lib/use-error-message";
import { reorderCategories, reorderFields, rescanNow, testAntivirus } from "./actions";

/**
 * O imagine a Descărcărilor în ACP (iconița / coperta categoriei, watermark-ul): popupul sistemului încarcă imaginea
 * imediat, iar id-ul ei ajunge într-un câmp ascuns, salvat cu formularul.
 */
export function GcsDownloadImageField({ name, kind, title, initial }: { name: string; kind: "icon" | "cover" | "watermark"; title: string; initial: { id: string; url: string } | null }) {
  const post = useUploadPost();
  const [image, setImage] = useState(initial);
  return (
    <>
      <GcsUploadInput
        title={title}
        rules={UPLOAD_RULES.image(3)}
        current={image ? { url: image.url, name: title } : null}
        upload={async (file, onProgress) => {
          const fd = new FormData();
          fd.set("kind", kind);
          fd.set("file", file);
          const res = await post<{ id: string; url: string }>("/api/acp/downloads/image", fd, onProgress);
          if (!res.ok) return res.error;
          setImage(res.data);
          return null;
        }}
        onRemove={() => setImage(null)}
        testId={`gcs-acp-download-${kind}`}
      />
      <input type="hidden" name={name} value={image?.id ?? ""} />
    </>
  );
}

/** Butoanele paginii Antivirus: testul cu fișierul standard și rescanarea acum. */
export function GcsAntivirusTools({ canEdit }: { canEdit: boolean }) {
  const t = useTranslations("acp.downloads.antivirus");
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className="gcs-dlAvTools">
      <GcsButton
        variant="primary"
        icon={<GcsIconSvg icon={faFlask} />}
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await testAntivirus();
            if (!res.ok) setResult({ ok: false, text: errorMessage(res.error) });
            else setResult(res.data.ok ? { ok: true, text: t("testOk", { signature: res.data.result }) } : { ok: false, text: t("testFail", { result: res.data.result }) });
          })
        }
        data-testid="gcs-acp-av-test"
      >
        {t("test")}
      </GcsButton>
      {canEdit && (
        <GcsButton
          variant="ghost"
          icon={<GcsIconSvg icon={faRotate} />}
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await rescanNow();
              setResult(res.ok ? { ok: true, text: t("rescanQueued") } : { ok: false, text: errorMessage(res.error) });
              router.refresh();
            })
          }
          data-testid="gcs-acp-av-rescan"
        >
          {t("rescan")}
        </GcsButton>
      )}
      {result && (
        <p className={result.ok ? "gcs-formOk" : "gcs-formError"} role={result.ok ? "status" : "alert"} data-testid="gcs-acp-av-result">
          {result.text}
        </p>
      )}
    </div>
  );
}

/** Butoanele ↑ / ↓ ale unui rând (categoriile între frați, câmpurile): ordinea se salvează imediat. */
export function GcsDownloadOrderButtons({ kind, parentId = null, ids, index, name }: { kind: "category" | "field"; parentId?: number | null; ids: number[]; index: number; name: string }) {
  const t = useTranslations("acp.downloads");
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const move = (delta: -1 | 1) =>
    start(async () => {
      const next = [...ids];
      const [row] = next.splice(index, 1);
      next.splice(index + delta, 0, row!);
      const res = kind === "category" ? await reorderCategories(parentId, next) : await reorderFields(next);
      if (!res.ok) setError(errorMessage(res.error));
      else {
        setError(null);
        router.refresh();
      }
    });
  return (
    <span className="gcs-dlOrder">
      <button type="button" className="gcs-dlIconBtn gcs-sweep" disabled={pending || index === 0} onClick={() => move(-1)} aria-label={t("moveUp", { name })} title={t("moveUp", { name })}>
        <GcsIconSvg icon={faArrowUp} />
      </button>
      <button type="button" className="gcs-dlIconBtn gcs-sweep" disabled={pending || index === ids.length - 1} onClick={() => move(1)} aria-label={t("moveDown", { name })} title={t("moveDown", { name })}>
        <GcsIconSvg icon={faArrowDown} />
      </button>
      {error && <span role="alert" className="gcs-formError">{error}</span>}
    </span>
  );
}
