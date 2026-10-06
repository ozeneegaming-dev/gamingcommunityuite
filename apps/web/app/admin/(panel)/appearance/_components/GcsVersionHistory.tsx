"use client";

import { faClockRotateLeft, faCodeCompare, faRotateLeft, faUser } from "@fortawesome/free-solid-svg-icons";
import { GcsButton, GcsIconSvg } from "@gcs/ui";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { GcsDiffView } from "./GcsDiffView";

export type GcsHistoryVersion = { id: number; action: string; authorName: string; createdAt: string; text: string };

/**
 * Istoricul unui fișier CSS sau al unui șablon: versiunile (cine, când, ce acțiune), diferențele versiunii alese față de
 * cea anterioară sau față de original și „Restaurează”.
 */
export function GcsVersionHistory({
  versions,
  original,
  canRestore,
  busy,
  onRestore,
}: {
  versions: GcsHistoryVersion[];
  /** Originalul: prima versiune a fișierului CSS sau șablonul implicit din cod. */
  original: string;
  canRestore: boolean;
  busy: boolean;
  onRestore: (id: number) => void;
}) {
  const t = useTranslations("acp.codeEditor");
  const format = useFormatter();
  const [selected, setSelected] = useState<number | null>(versions[0]?.id ?? null);
  const [compare, setCompare] = useState<"previous" | "original">("previous");
  const index = versions.findIndex((v) => v.id === selected);
  const version = index === -1 ? null : versions[index]!;
  const before = compare === "original" ? original : (versions[index + 1]?.text ?? "");

  if (versions.length === 0) {
    return (
      <p className="gcs-muted gcs-history__empty" data-testid="gcs-history-empty">
        {t("history.empty")}
      </p>
    );
  }
  return (
    <div className="gcs-history" data-testid="gcs-history">
      <ol className="gcs-history__list" aria-label={t("history.title")}>
        {versions.map((v) => (
          <li key={v.id}>
            <button
              type="button"
              className={`gcs-history__item${v.id === selected ? " gcs-history__item--active" : ""}`}
              aria-pressed={v.id === selected}
              onClick={() => setSelected(v.id)}
              data-testid="gcs-history-item"
              data-action={v.action}
            >
              <span className="gcs-history__icon" aria-hidden="true">
                <GcsIconSvg icon={faClockRotateLeft} />
              </span>
              <span className="gcs-history__text">
                <strong>{t.has(`actions.${v.action}`) ? t(`actions.${v.action}`) : v.action}</strong>
                <span className="gcs-history__meta">
                  <GcsIconSvg icon={faUser} /> {v.authorName || t("history.system")} ·{" "}
                  <time dateTime={v.createdAt} title={format.dateTime(new Date(v.createdAt), { dateStyle: "long", timeStyle: "medium" })}>
                    {format.relativeTime(new Date(v.createdAt), new Date())}
                  </time>
                </span>
              </span>
            </button>
          </li>
        ))}
      </ol>
      {version && (
        <div className="gcs-history__detail">
          <div className="gcs-history__bar">
            <div className="gcs-codeWs__seg" role="group" aria-label={t("history.compare")}>
              <GcsIconSvg icon={faCodeCompare} className="gcs-codeWs__segIcon" />
              {(["previous", "original"] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`gcs-codeWs__segBtn${compare === c ? " gcs-codeWs__segBtn--active" : ""}`}
                  aria-pressed={compare === c}
                  onClick={() => setCompare(c)}
                  data-testid={`gcs-history-compare-${c}`}
                >
                  {t(`history.${c}`)}
                </button>
              ))}
            </div>
            {canRestore && (
              <GcsButton variant="ghost" size="sm" icon={<GcsIconSvg icon={faRotateLeft} />} onClick={() => onRestore(version.id)} disabled={busy} data-testid="gcs-history-restore">
                {t("history.restore")}
              </GcsButton>
            )}
          </div>
          <GcsDiffView
            before={before}
            after={version.text}
            labels={{ same: t("diff.same"), added: t("diff.added"), removed: t("diff.removed"), skipped: t.raw("diff.skipped") as string }}
          />
        </div>
      )}
    </div>
  );
}
