"use client";

import { faUpload } from "@fortawesome/free-solid-svg-icons";
import type { GcsResult } from "@gcs/core";
import { GcsButton, GcsIconSvg } from "@gcs/ui";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { useErrorMessage } from "@/lib/use-error-message";

/** Câte fișiere pleacă într-o cerere (sub limita corpului unei cereri). */
const BATCH = 10;
const MAX_FILES = 100;

type UploadResult = { saved: string[]; errors: { file: string; error: string }[] };

/**
 * Încărcarea în masă a imaginilor hărților: mai multe fișiere odată, numele fișierului dă numele hărții
 * (`de_dust2.jpg` → `de_dust2`). Fișierele pleacă în loturi de 10 la `/api/servers/maps/upload`.
 */
export function GcsMapUpload({ games }: { games: { key: string; name: string }[] }) {
  const t = useTranslations("acp.serverMaps.upload");
  const tErr = useTranslations("errors.fields");
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const game = String(new FormData(form).get("game") ?? "");
    const input = form.elements.namedItem("files") as HTMLInputElement | null;
    const files = Array.from(input?.files ?? []);
    if (files.length === 0) return setError(t("none"));
    if (files.length > MAX_FILES) return setError(t("tooMany", { max: MAX_FILES }));
    setPending(true);
    setError(null);
    const total: UploadResult = { saved: [], errors: [] };
    for (let i = 0; i < files.length; i += BATCH) {
      const fd = new FormData();
      fd.set("game", game);
      for (const f of files.slice(i, i + BATCH)) fd.append("files", f);
      const res = await fetch("/api/servers/maps/upload", { method: "POST", body: fd });
      const json = (await res.json().catch(() => null)) as GcsResult<UploadResult> | null;
      if (!json || !json.ok) {
        setError(json ? errorMessage(json.error) : t("failed"));
        break;
      }
      total.saved.push(...json.data.saved);
      total.errors.push(...json.data.errors);
    }
    setPending(false);
    setResult(total);
    form.reset();
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }} data-testid="gcs-map-upload">
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
        <label className="gcs-field" style={{ width: 220 }}>
          {t("game")}
          <select className="gcs-input" name="game" defaultValue={games[0]?.key}>
            {games.map((g) => (
              <option key={g.key} value={g.key}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
        <label className="gcs-field" style={{ flex: "1 1 320px" }}>
          {t("files")}
          <input className="gcs-input" type="file" name="files" accept="image/png,image/jpeg,image/webp,image/gif" multiple />
          <span className="gcs-field__hint">{t("hint")}</span>
        </label>
        <GcsButton type="submit" variant="primary" disabled={pending} icon={<GcsIconSvg icon={faUpload} />}>
          {pending ? t("uploading") : t("submit")}
        </GcsButton>
      </div>
      {error && (
        <span role="alert" style={{ color: "#FF8A91", fontWeight: 600, fontSize: 13 }}>
          {error}
        </span>
      )}
      {result && (
        <div role="status" style={{ fontSize: 14 }} data-testid="gcs-map-upload-result">
          {t("saved", { count: result.saved.length })}
          {result.errors.length > 0 && (
            <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
              {result.errors.map((e) => (
                <li key={e.file}>
                  <code>{e.file}</code>: {tErr.has(e.error) ? tErr(e.error) : e.error}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </form>
  );
}
