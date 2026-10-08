"use client";

import { faGamepad, faLink, faLinkSlash, faShield, faShieldHalved, faSignature, faKey } from "@fortawesome/free-solid-svg-icons";
import { faSteam } from "@fortawesome/free-brands-svg-icons";
import { faCircleQuestion } from "@fortawesome/free-regular-svg-icons";
import { GcsIconSvg } from "@gcs/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { useErrorMessage } from "@/lib/use-error-message";
import { createLinkCode, unlinkGameIdentity } from "../../bridge-actions";
import { playerHref } from "./types";

export type GcsGameIdentity = { id: number; kind: string; trust: string; name: string; value: string; linkSource: string | null; linkedAt: string | null };

const KIND_ICON = { STEAM: faSteam, NONSTEAM: faGamepad, NAME: faSignature } as const;
const TRUST_ICON = { HIGH: faShieldHalved, MEDIUM: faShield, LOW: faCircleQuestion } as const;

/** Secundele rămase până la `iso` (actualizate la o secundă). */
function useRemaining(iso: string | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!iso) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [iso]);
  return iso ? Math.max(0, Math.round((Date.parse(iso) - now) / 1000)) : 0;
}

/**
 * Setări → Cont → „Conturi de joc” (specul 2026-10-08-servere-pagini §8): codul de legare de unică folosință (scris în
 * joc cu `/gcs COD`, valabil 10 minute), identitățile legate cu tipul și încrederea lor și dezlegarea celor proprii.
 * Identitatea Steam legată prin contul Steam se dezleagă odată cu contul (mai sus, în „Conturi legate”).
 */
export function GcsGameAccounts({ identities, canLink, command }: { identities: GcsGameIdentity[]; canLink: boolean; command: string }) {
  const t = useTranslations("bridge.gameAccounts");
  const ti = useTranslations("bridge.identity");
  const format = useFormatter();
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const remaining = useRemaining(code?.expiresAt ?? null);
  const expired = code !== null && remaining === 0;

  async function generate() {
    setPending(true);
    setError(null);
    const res = await createLinkCode({});
    setPending(false);
    if (!res.ok) return setError(errorMessage(res.error));
    setCode(res.data);
  }

  async function unlink(playerId: number) {
    setPending(true);
    setError(null);
    const res = await unlinkGameIdentity({ playerId });
    setPending(false);
    if (!res.ok) return setError(errorMessage(res.error));
    router.refresh();
  }

  return (
    <section className="gcs-settingsFieldset" aria-labelledby="gcs-game-accounts" data-testid="gcs-game-accounts">
      <h2 id="gcs-game-accounts" className="gcs-settingsTitle">
        <GcsIconSvg icon={faGamepad} className="gcs-hIcon" />
        {t("title")}
      </h2>
      <p className="gcs-muted" style={{ margin: 0, maxWidth: "72ch" }}>
        {t("lead")}
      </p>

      {canLink && (
        <div className="gcs-linkCode" data-state={code ? (expired ? "expired" : "active") : "idle"}>
          {code && !expired ? (
            <>
              <p className="gcs-linkCode__hint">{t("type")}</p>
              <p className="gcs-linkCode__command">
                <code data-testid="gcs-link-code">
                  {command} {code.code}
                </code>
              </p>
              <p className="gcs-linkCode__timer" role="timer" aria-live="off">
                {t("expiresIn", { minutes: Math.floor(remaining / 60), seconds: String(remaining % 60).padStart(2, "0") })}
              </p>
            </>
          ) : (
            <p className="gcs-linkCode__hint">{expired ? t("expired") : t("how", { command })}</p>
          )}
          <button type="button" className="gcs-btn gcs-btn--primary" onClick={() => void generate()} disabled={pending} data-testid="gcs-link-code-generate">
            <GcsIconSvg icon={faKey} />
            {code ? t("regenerate") : t("generate")}
          </button>
        </div>
      )}

      {identities.length === 0 ? (
        <p className="gcs-serverNote" data-testid="gcs-game-accounts-empty">
          {t("none")}
        </p>
      ) : (
        <ul className="gcs-gameAccounts" data-testid="gcs-game-identities">
          {identities.map((i) => {
            const steamLinked = i.kind === "STEAM" && i.linkSource === "STEAM";
            return (
              <li key={i.id} className="gcs-gameAccounts__row" data-testid="gcs-game-identity">
                <span className="gcs-gameAccounts__who">
                  <Link href={playerHref({ id: i.id, name: i.name || i.value })} className="gcs-gameAccounts__name">
                    {i.name || i.value}
                  </Link>
                  <span className="gcs-identity gcs-identity--compact" data-trust={i.trust}>
                    <span className="gcs-identity__kind">
                      <GcsIconSvg icon={KIND_ICON[i.kind as keyof typeof KIND_ICON] ?? faGamepad} />
                      {ti(`kind.${i.kind}`)}
                    </span>
                    <span className="gcs-identity__trust">
                      <GcsIconSvg icon={TRUST_ICON[i.trust as keyof typeof TRUST_ICON] ?? faShield} />
                      {ti(`trustShort.${i.trust}`)}
                    </span>
                    {i.kind !== "NAME" && <code className="gcs-identity__id">{i.value}</code>}
                  </span>
                  <span className="gcs-gameAccounts__meta">
                    <GcsIconSvg icon={faLink} />
                    {t(`source.${i.linkSource ?? "CODE"}`)}
                    {i.linkedAt && ` · ${format.dateTime(new Date(i.linkedAt), { dateStyle: "medium" })}`}
                  </span>
                </span>
                {steamLinked ? (
                  <span className="gcs-field__hint">{t("steamHint")}</span>
                ) : (
                  <button type="button" className="gcs-btn gcs-btn--ghost gcs-btn--sm" disabled={pending} onClick={() => void unlink(i.id)} data-testid="gcs-game-identity-unlink">
                    <GcsIconSvg icon={faLinkSlash} />
                    {t("unlink")}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {error && (
        <p role="alert" className="gcs-formError" style={{ margin: 0 }}>
          {error}
        </p>
      )}
    </section>
  );
}
