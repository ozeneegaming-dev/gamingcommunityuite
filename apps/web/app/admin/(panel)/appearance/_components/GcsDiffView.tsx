"use client";

import { diffHunks, diffLines, diffStats } from "@gcs/core/diff";
import { useMemo } from "react";

/**
 * Diferențele pe rânduri dintre două versiuni (calculate în browser): rândurile adăugate (verde, `+`), cele șterse
 * (roșu, `−`), cu trei rânduri de context; restul se pliază într-un separator.
 */
export function GcsDiffView({
  before,
  after,
  labels,
  testId = "gcs-diff",
}: {
  before: string;
  after: string;
  labels: { same: string; added: string; removed: string; skipped: string };
  testId?: string;
}) {
  const lines = useMemo(() => diffLines(before, after), [before, after]);
  const stats = diffStats(lines);
  const hunks = useMemo(() => diffHunks(lines, 3), [lines]);
  if (stats.added === 0 && stats.removed === 0) {
    return (
      <p className="gcs-diff__same" data-testid={testId}>
        {labels.same}
      </p>
    );
  }
  return (
    <div className="gcs-diff" data-testid={testId}>
      <p className="gcs-diff__stats">
        <span className="gcs-diff__statAdd">+{stats.added}</span> {labels.added} · <span className="gcs-diff__statDel">−{stats.removed}</span> {labels.removed}
      </p>
      <div className="gcs-diff__lines" role="table">
        {hunks.map((h, i) =>
          "skipped" in h ? (
            <div key={i} className="gcs-diff__skip" role="row">
              <span role="cell">{labels.skipped.replace("{count}", String(h.skipped))}</span>
            </div>
          ) : (
            <div key={i} className={`gcs-diff__line gcs-diff__line--${h.op}`} role="row" data-op={h.op}>
              <span className="gcs-diff__no" role="cell">
                {h.a ?? ""}
              </span>
              <span className="gcs-diff__no" role="cell">
                {h.b ?? ""}
              </span>
              <span className="gcs-diff__sign" role="cell" aria-hidden="true">
                {h.op === "add" ? "+" : h.op === "del" ? "−" : " "}
              </span>
              <code className="gcs-diff__text" role="cell">
                {h.text || " "}
              </code>
            </div>
          ),
        )}
      </div>
    </div>
  );
}
