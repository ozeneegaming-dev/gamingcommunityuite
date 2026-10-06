"use client";

import { useState, useTransition } from "react";
import { setChatSlowMode } from "../../chat-actions";

const OPTIONS = [0, 5, 10, 30, 60, 300];

/** Slow mode-ul canalului (moderatori). */
export function GcsSlowModeControl({ channel, seconds, label, off }: { channel: string; seconds: number; label: string; off: string }) {
  const [value, setValue] = useState(seconds);
  const [pending, start] = useTransition();
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14 }}>
      {label}
      <select
        className="gcs-input"
        style={{ width: "auto" }}
        value={value}
        disabled={pending}
        onChange={(e) => {
          const next = Number(e.target.value);
          setValue(next);
          start(async () => void (await setChatSlowMode({ channel, seconds: next })));
        }}
        data-testid="gcs-chat-slowmode"
      >
        {[...new Set([...OPTIONS, seconds])].sort((a, b) => a - b).map((s) => (
          <option key={s} value={s}>
            {s === 0 ? off : `${s} s`}
          </option>
        ))}
      </select>
    </label>
  );
}
