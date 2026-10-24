"use client";

import { GcsButton } from "@gcs/ui";
import { useState } from "react";

export type GcsCronPanelLabels = {
  title: string;
  body: string;
  schedule: string;
  node: string;
  curl: string;
  copy: string;
  copied: string;
  check: string;
  checking: string;
  never: string;
  /** Cu `{time}` (ex. „acum 2 minute”). */
  lastRun: string;
  stale: string;
};

type Props = {
  commands: { schedule: string; node: string; curl: string | null };
  initialLastRun: number | null;
  /** După cât timp fără rulare cron-ul e „oprit” (ms). */
  staleMs: number;
  locale: string;
  labels: GcsCronPanelLabels;
};

function ago(locale: string, at: number): string {
  const sec = Math.round((at - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (Math.abs(sec) < 60) return rtf.format(sec, "second");
  if (Math.abs(sec) < 3600) return rtf.format(Math.round(sec / 60), "minute");
  if (Math.abs(sec) < 86_400) return rtf.format(Math.round(sec / 3600), "hour");
  return rtf.format(Math.round(sec / 86_400), "day");
}

function Command({ id, label, text, labels }: { id: string; label: string; text: string; labels: GcsCronPanelLabels }) {
  const [copied, setCopied] = useState(false);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ fontSize: 13, fontWeight: 700 }}>{label}</span>
      <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
        <code
          data-testid={`gcs-cron-${id}`}
          style={{ flex: 1, minWidth: 0, padding: "10px 12px", borderRadius: 10, background: "var(--gcs-surface2)", border: "1px solid var(--gcs-border)", fontSize: 12.5, overflowWrap: "anywhere", userSelect: "all" }}
        >
          {text}
        </code>
        <GcsButton
          variant="ghost"
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(text).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            });
          }}
        >
          {copied ? labels.copied : labels.copy}
        </GcsButton>
      </div>
    </div>
  );
}

/**
 * Cron-ul ediției Lite (pasul final al instalării și ACP → Sistem → Cron): programarea, comanda de copiat în panoul
 * gazdei (Node sau curl) și verificarea că rulează (momentul ultimei rulări, scris de `/api/cron`).
 */
/** Momentul ultimei rulări (ms), citit din nou de pe server (`/api/cron/status`, merge și după instalare). */
async function lastRunNow(): Promise<number | null> {
  const res = await fetch("/api/cron/status", { cache: "no-store" });
  if (!res.ok) return null;
  const body = (await res.json()) as { lastRunAt?: number | null };
  return typeof body.lastRunAt === "number" ? body.lastRunAt : null;
}

export function GcsCronPanel({ commands, initialLastRun, staleMs, locale, labels }: Props) {
  const [lastRun, setLastRun] = useState(initialLastRun);
  const [checking, setChecking] = useState(false);
  const running = lastRun !== null && Date.now() - lastRun < staleMs;
  return (
    <section aria-label={labels.title} data-testid="gcs-cron-panel" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <h2 style={{ margin: 0, fontSize: 18 }}>{labels.title}</h2>
      <p style={{ margin: 0, color: "var(--gcs-muted)", fontSize: 14, lineHeight: 1.6 }}>{labels.body}</p>
      <p style={{ margin: 0, fontSize: 14 }}>
        {labels.schedule} <code data-testid="gcs-cron-schedule">{commands.schedule}</code>
      </p>
      <Command id="node" label={labels.node} text={commands.node} labels={labels} />
      {commands.curl && <Command id="curl" label={labels.curl} text={commands.curl} labels={labels} />}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <GcsButton
          variant="primary"
          type="button"
          disabled={checking}
          data-testid="gcs-cron-check"
          onClick={async () => {
            setChecking(true);
            try {
              setLastRun(await lastRunNow());
            } catch {
              // Rețeaua: starea rămâne cea de dinainte; „Verifică” se poate apăsa din nou.
            } finally {
              setChecking(false);
            }
          }}
        >
          {checking ? labels.checking : labels.check}
        </GcsButton>
        <span role="status" data-testid="gcs-cron-status" data-running={running ? "true" : "false"} style={{ fontSize: 14, fontWeight: 600, color: running ? "var(--gcs-ok)" : "var(--gcs-muted)" }}>
          {lastRun === null ? labels.never : running ? labels.lastRun.replace("{time}", ago(locale, lastRun)) : `${labels.stale} ${labels.lastRun.replace("{time}", ago(locale, lastRun))}`}
        </span>
      </div>
    </section>
  );
}
