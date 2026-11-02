"use client";

import { GcsButton } from "@gcs/ui";
import { useState, type ReactNode } from "react";

type Props = {
  stepLabels: Record<string, string>;
  labels: { start: string; retry: string; copyLog: string; copied: string; progress: string; failed: string; doneTitle: string; doneBody: string; enter: string; back: string };
  /** Afișat după instalare (ediția Lite: pasul final, cron-ul). */
  afterDone?: ReactNode;
};

type Phase = { kind: "idle" } | { kind: "running" } | { kind: "error"; message: string } | { kind: "done"; finishUrl: string };

/** Pasul „Instalare”: pornește rularea (POST /install/run) și afișează progresul primit prin SSE. */
export function RunStep({ stepLabels, labels, afterDone }: Props) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [pct, setPct] = useState(0);
  const [log, setLog] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);

  async function start() {
    setPhase({ kind: "running" });
    setPct(0);
    setLog([]);
    const res = await fetch("/install/run", { method: "POST" });
    if (!res.ok || !res.body) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      return setPhase({ kind: "error", message: body.error ?? `HTTP ${res.status}` });
    }
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      let sep: number;
      while ((sep = buffer.indexOf("\n\n")) >= 0) {
        const chunk = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const event = /^event: (.+)$/m.exec(chunk)?.[1];
        const data = JSON.parse(/^data: (.+)$/m.exec(chunk)?.[1] ?? "{}") as Record<string, string | number>;
        const time = new Date().toLocaleTimeString();
        if (event === "progress") {
          setPct(Number(data.pct));
          setLog((l) => [...l, `[${time}] ✓ ${stepLabels[String(data.stepKey)] ?? data.stepKey}`]);
        } else if (event === "error") {
          setLog((l) => [...l, `[${time}] ✗ ${data.message}`]);
          setPhase({ kind: "error", message: String(data.message) });
        } else if (event === "done") {
          setPhase({ kind: "done", finishUrl: String(data.finishUrl) });
        }
      }
    }
  }

  async function copyLog() {
    await navigator.clipboard.writeText(log.join("\n")).catch(() => {});
    setCopied(true);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div role="progressbar" aria-label={labels.progress} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} style={{ height: 10, borderRadius: 999, background: "var(--gcs-surface2)", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: phase.kind === "error" ? "var(--gcs-danger)" : "var(--gcs-accent)", transition: "width .3s ease" }} />
      </div>
      {log.length > 0 && (
        <pre
          aria-live="polite"
          data-testid="gcs-install-log"
          style={{ margin: 0, padding: "12px 14px", borderRadius: "var(--gcs-radius-sm)", background: "var(--gcs-surface2)", border: "1px solid var(--gcs-border)", fontSize: 12.5, lineHeight: 1.7, whiteSpace: "pre-wrap", maxHeight: 260, overflowY: "auto" }}
        >
          {log.join("\n")}
        </pre>
      )}
      {phase.kind === "error" && (
        <p role="alert" className="gcs-field__error" style={{ fontSize: 13 }}>
          {labels.failed.replace("{error}", phase.message)}
        </p>
      )}
      {phase.kind === "done" && (
        <div role="status" style={{ padding: "16px 18px", borderRadius: "var(--gcs-radius-sm)", background: "color-mix(in srgb, var(--gcs-ok) 8%, transparent)", border: "1px solid color-mix(in srgb, var(--gcs-ok) 30%, transparent)", display: "flex", flexDirection: "column", gap: 6 }}>
          <strong className="gcs-display" style={{ fontSize: 18 }}>
            {labels.doneTitle}
          </strong>
          <span style={{ fontSize: 14, color: "var(--gcs-muted)" }}>{labels.doneBody}</span>
        </div>
      )}
      {phase.kind === "done" && afterDone}
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", paddingTop: 8, borderTop: "1px solid var(--gcs-border)" }}>
        {phase.kind === "idle" ? (
          <GcsButton variant="ghost" type="button" onClick={() => window.location.assign("/install/data")}>
            {labels.back}
          </GcsButton>
        ) : (
          <GcsButton variant="ghost" type="button" onClick={copyLog} disabled={log.length === 0}>
            {copied ? labels.copied : labels.copyLog}
          </GcsButton>
        )}
        {phase.kind === "done" ? (
          <GcsButton variant="primary" type="button" onClick={() => window.location.assign(phase.finishUrl)}>
            {labels.enter}
          </GcsButton>
        ) : (
          <GcsButton variant="primary" type="button" onClick={start} disabled={phase.kind === "running"}>
            {phase.kind === "error" ? labels.retry : labels.start}
          </GcsButton>
        )}
      </div>
    </div>
  );
}
