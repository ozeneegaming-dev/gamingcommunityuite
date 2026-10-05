"use client";

import { GcsButton } from "@gcs/ui";
import { useState } from "react";
import { sendTestEmail } from "./actions";

type Props = { labels: { submit: string; sent: string; failed: string } };

/** „Trimite email de test”: către adminul curent, cu setările SMTP salvate (spec §12.1, Setări → Email). */
export function TestEmailButton({ labels }: Props) {
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, setPending] = useState(false);

  async function send() {
    setPending(true);
    setStatus(null);
    const result = await sendTestEmail();
    setPending(false);
    setStatus(result.ok ? { ok: true, text: labels.sent.replace("{email}", result.to) } : { ok: false, text: labels.failed.replace("{error}", result.error) });
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
      <GcsButton variant="ghost" onClick={send} disabled={pending}>
        {labels.submit}
      </GcsButton>
      {status && (
        <span role={status.ok ? "status" : "alert"} style={{ fontSize: 13, fontWeight: 600, color: status.ok ? "var(--gcs-ok)" : "#FF8A91" }}>
          {status.text}
        </span>
      )}
    </div>
  );
}
