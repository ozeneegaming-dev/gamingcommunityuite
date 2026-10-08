"use client";

import { faCircleMinus, faCopy, faKey, faPlus, faRotate } from "@fortawesome/free-solid-svg-icons";
import type { GcsResult } from "@gcs/core";
import { GcsButton, GcsIconSvg } from "@gcs/ui";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { useErrorMessage } from "@/lib/use-error-message";
import { createBridgeKey, revokeBridgeKey, rotateBridgeKey } from "./bridge-actions";

export type GcsBridgeKeyItem = {
  id: number;
  keyId: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
  lastIp: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  active: boolean;
  /** Datele formatate pe server (fusul orar și limba membrului). */
  lastUsedLabel: string | null;
  expiresLabel: string | null;
};

type Props = { serverId: number; game: string; siteUrl: string; keys: GcsBridgeKeyItem[]; canEdit: boolean; canDelete: boolean };

/**
 * Cheile API ale unui server: lista (fără secret), „Creează cheie”, „Rotește” (cheia veche mai merge 10 minute) și
 * „Revocă”. Cheia nouă se arată o singură dată, cu configul de copiat pentru plugin.
 */
export function GcsBridgeKeys({ serverId, game, siteUrl, keys, canEdit, canDelete }: Props) {
  const t = useTranslations("acp.bridge.keys");
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const [fresh, setFresh] = useState<{ keyId: string; token: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState(false);

  async function run(fn: () => Promise<GcsResult<{ keyId: string; token: string } | null>>) {
    setPending(true);
    setError(null);
    const result = await fn();
    setPending(false);
    if (!result.ok) return setError(errorMessage(result.error));
    if (result.data) {
      setFresh(result.data);
      setCopied(false);
    }
    router.refresh();
  }

  function onCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    void run(() => createBridgeKey(serverId, fd));
    e.currentTarget.reset();
  }

  const base = `${siteUrl.replace(/\/+$/, "")}/api/servers/bridge/v1`;
  const config =
    fresh &&
    (game === "cs16"
      ? `// addons/amxmodx/configs/gcs_bridge.cfg\ngcs_url "${siteUrl.replace(/\/+$/, "")}"\ngcs_key "${fresh.token}"`
      : `// addons/counterstrikesharp/configs/plugins/GcsBridge/GcsBridge.json\n{\n  "Url": "${siteUrl.replace(/\/+$/, "")}",\n  "Key": "${fresh.token}"\n}`);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {fresh && (
        <div className="gcs-card" role="status" style={{ padding: 14, borderColor: "var(--gcs-ok)", display: "flex", flexDirection: "column", gap: 10 }} data-testid="gcs-bridge-fresh-key">
          <strong>
            <GcsIconSvg icon={faKey} /> {t("freshTitle")}
          </strong>
          <span className="gcs-muted" style={{ fontSize: 13 }}>
            {t("freshHint")}
          </span>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input className="gcs-input" readOnly value={fresh.token} aria-label={t("token")} style={{ flex: "1 1 320px", fontFamily: "var(--gcs-font-mono, monospace)" }} data-testid="gcs-bridge-token" onFocus={(e) => e.currentTarget.select()} />
            <GcsButton
              type="button"
              variant="ghost"
              icon={<GcsIconSvg icon={faCopy} />}
              onClick={() => {
                void navigator.clipboard?.writeText(fresh.token).then(() => setCopied(true));
              }}
            >
              {copied ? t("copied") : t("copy")}
            </GcsButton>
          </div>
          <span className="gcs-muted" style={{ fontSize: 13 }}>
            {t("configHint", { url: base })}
          </span>
          <pre className="gcs-acpList__code" style={{ margin: 0, padding: 10, overflowX: "auto", whiteSpace: "pre" }}>
            {config}
          </pre>
        </div>
      )}
      {error && (
        <span role="alert" style={{ color: "#FF8A91", fontWeight: 600, fontSize: 13 }}>
          {error}
        </span>
      )}
      {keys.length === 0 ? (
        <p className="gcs-muted" style={{ margin: 0 }}>
          {t("empty")}
        </p>
      ) : (
        <table className="gcs-table__table" data-testid="gcs-bridge-keys">
          <thead>
            <tr>
              <th className="gcs-table__th" scope="col">{t("keyId")}</th>
              <th className="gcs-table__th" scope="col">{t("label")}</th>
              <th className="gcs-table__th" scope="col">{t("lastUsed")}</th>
              <th className="gcs-table__th" scope="col">{t("status")}</th>
              <th className="gcs-table__th" scope="col" />
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k.id} className="gcs-table__row" data-testid="gcs-bridge-key" data-key={k.keyId}>
                <td className="gcs-table__td">
                  <code>{k.keyId}</code>
                </td>
                <td className="gcs-table__td">{k.label || "—"}</td>
                <td className="gcs-table__td">{k.lastUsedLabel ? `${k.lastUsedLabel}${k.lastIp ? ` · ${k.lastIp}` : ""}` : t("never")}</td>
                <td className="gcs-table__td">
                  <span className={`gcs-badge ${k.active ? (k.expiresAt ? "gcs-badge--warn" : "gcs-badge--ok") : "gcs-badge--neutral"}`}>
                    {k.revokedAt ? t("revoked") : !k.active ? t("expired") : k.expiresAt ? t("grace", { time: k.expiresLabel ?? "" }) : t("active")}
                  </span>
                </td>
                <td className="gcs-table__td" style={{ whiteSpace: "nowrap" }}>
                  {k.active && canEdit && (
                    <GcsButton size="sm" variant="ghost" type="button" disabled={pending} icon={<GcsIconSvg icon={faRotate} />} onClick={() => window.confirm(t("rotateConfirm")) && void run(() => rotateBridgeKey(serverId, k.id))}>
                      {t("rotate")}
                    </GcsButton>
                  )}
                  {!k.revokedAt && canDelete && (
                    <GcsButton size="sm" variant="ghost" type="button" disabled={pending} icon={<GcsIconSvg icon={faCircleMinus} />} onClick={() => window.confirm(t("revokeConfirm")) && void run(async () => {
                      const r = await revokeBridgeKey(serverId, k.id);
                      return r.ok ? { ok: true as const, data: null } : r;
                    })}>
                      {t("revoke")}
                    </GcsButton>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {canEdit && (
        <form onSubmit={onCreate} style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <label className="gcs-field" style={{ width: 260 }}>
            {t("newLabel")}
            <input className="gcs-input" name="label" maxLength={60} placeholder={t("newLabelHint")} />
          </label>
          <GcsButton variant="primary" type="submit" disabled={pending} icon={<GcsIconSvg icon={faPlus} />} data-testid="gcs-bridge-key-create">
            {t("create")}
          </GcsButton>
        </form>
      )}
    </div>
  );
}
