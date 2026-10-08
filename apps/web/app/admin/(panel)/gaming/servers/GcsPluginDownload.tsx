"use client";

import { faDownload } from "@fortawesome/free-solid-svg-icons";
import type { GcsResult } from "@gcs/core";
import { GcsButton, GcsIconSvg } from "@gcs/ui";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useErrorMessage } from "@/lib/use-error-message";

type Props = {
  /** Pachetul unui server (cu o cheie nouă) sau, fără el, pachetul general al jocului. */
  serverId?: number;
  game: string;
  label: string;
  variant?: "primary" | "ghost";
  testId?: string;
};

/**
 * Descărcarea pachetului pluginului (specul 2026-10-08-servere-plugin-v2 §4–5): cererea `POST` la
 * `/api/servers/bridge/package`, arhiva ZIP salvată de browser; o eroare (dreptul, limita, release-ul lipsă) se arată
 * lângă buton. Arhiva unui server conține o cheie nouă, deci lista cheilor se reîncarcă după descărcare.
 */
export function GcsPluginDownload({ serverId, game, label, variant = "ghost", testId }: Props) {
  const t = useTranslations("acp.bridge.package");
  const errorMessage = useErrorMessage();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function download() {
    setPending(true);
    setMessage(null);
    try {
      const res = await fetch("/api/servers/bridge/package", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(serverId !== undefined ? { serverId } : { game }),
      });
      if (!res.ok || !(res.headers.get("content-type") ?? "").includes("application/zip")) {
        const result = (await res.json().catch(() => null)) as GcsResult<null> | null;
        setMessage({ ok: false, text: result && !result.ok ? errorMessage(result.error) : t("failed") });
        return;
      }
      const filename = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? `gcs-bridge-${game}.zip`;
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setMessage({ ok: true, text: t("done", { file: filename }) });
      if (serverId !== undefined) router.refresh();
    } catch {
      setMessage({ ok: false, text: t("failed") });
    } finally {
      setPending(false);
    }
  }

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <GcsButton type="button" variant={variant} disabled={pending} icon={<GcsIconSvg icon={faDownload} />} onClick={() => void download()} data-testid={testId}>
        {pending ? t("downloading") : label}
      </GcsButton>
      {message && (
        <span role={message.ok ? "status" : "alert"} style={{ fontSize: 13, fontWeight: 600, color: message.ok ? "var(--gcs-ok)" : "#FF8A91" }}>
          {message.text}
        </span>
      )}
    </span>
  );
}
