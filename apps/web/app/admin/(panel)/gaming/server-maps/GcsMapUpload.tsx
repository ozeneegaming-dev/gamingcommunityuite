"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { GcsUploadInput } from "@/lib/ui-inputs";
import { UPLOAD_RULES } from "@/lib/ui-labels";
import { useUploadPost } from "@/lib/upload-request";

/** Câte fișiere pleacă într-o cerere (sub limita corpului unei cereri). */
const BATCH = 10;
const MAX_FILES = 100;
/** Ce primește `/api/servers/maps/upload`: PNG, JPG, WebP, GIF, cel mult 5 MB pe imagine. */
const RULES = UPLOAD_RULES.image(5);

type UploadResult = { saved: string[]; errors: { file: string; error: string }[] };

/**
 * Încărcarea în masă a imaginilor hărților: mai multe fișiere odată, din popupul sistemului (tragere, alegere, lipire,
 * verificările fiecărui fișier), numele fișierului dă numele hărții (`de_dust2.jpg` → `de_dust2`). Fișierele bune
 * pleacă în loturi de 10 la `/api/servers/maps/upload`, cu progresul tuturor loturilor în popup.
 */
export function GcsMapUpload({ games }: { games: { key: string; name: string }[] }) {
  const t = useTranslations("acp.serverMaps.upload");
  const tErr = useTranslations("errors.fields");
  const router = useRouter();
  const post = useUploadPost();
  const [game, setGame] = useState(games[0]?.key ?? "");
  const [result, setResult] = useState<UploadResult | null>(null);
  const [round, setRound] = useState(0);

  async function upload(files: File[], onProgress: (fraction: number) => void): Promise<string | null> {
    if (files.length > MAX_FILES) return t("tooMany", { max: MAX_FILES });
    const total: UploadResult = { saved: [], errors: [] };
    const batches = Math.ceil(files.length / BATCH);
    const finish = () => {
      setResult(total);
      setRound((r) => r + 1);
      router.refresh();
    };
    for (let b = 0; b < batches; b++) {
      const fd = new FormData();
      fd.set("game", game);
      for (const f of files.slice(b * BATCH, (b + 1) * BATCH)) fd.append("files", f);
      const res = await post<UploadResult>("/api/servers/maps/upload", fd, (fraction) => onProgress((b + fraction) / batches));
      if (!res.ok) {
        // Loturile de dinainte au ajuns: le arătăm, iar eroarea rămâne în popup.
        if (total.saved.length > 0 || total.errors.length > 0) finish();
        return res.error;
      }
      total.saved.push(...res.data.saved);
      total.errors.push(...res.data.errors);
    }
    finish();
    return null;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }} data-testid="gcs-map-upload">
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
        <label className="gcs-field" style={{ width: 220, maxWidth: "100%" }}>
          {t("game")}
          <select className="gcs-input" name="game" value={game} onChange={(e) => setGame(e.target.value)}>
            {games.map((g) => (
              <option key={g.key} value={g.key}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
        <div className="gcs-field" style={{ flex: "1 1 320px", minWidth: 0 }}>
          <span>{t("files")}</span>
          <GcsUploadInput key={round} title={t("title")} rules={RULES} multiple uploadMany={upload} disabled={!game} testId="gcs-map-upload-files" />
          <span className="gcs-field__hint">{t("hint")}</span>
        </div>
      </div>
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
    </div>
  );
}
