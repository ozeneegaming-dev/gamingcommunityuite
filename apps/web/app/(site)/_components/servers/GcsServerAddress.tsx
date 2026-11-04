"use client";

import { faCheck, faCopy } from "@fortawesome/free-solid-svg-icons";
import { GcsIconSvg } from "@gcs/ui";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

/** Copiază un text: Clipboard API, iar unde nu există (context nesigur) o selecție temporară. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    try {
      return document.execCommand("copy");
    } catch {
      return false;
    } finally {
      area.remove();
    }
  }
}

/** Starea butonului de copiere: „Copiat” 2 secunde după copiere (anunțat și cititoarelor de ecran). */
export function useCopy(text: string) {
  const [state, setState] = useState<"idle" | "ok" | "fail">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  async function copy() {
    const ok = await copyText(text);
    setState(ok ? "ok" : "fail");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 2000);
  }
  return { state, copy };
}

/** Banda adresei: `ip:port` (monospace, se selectează dintr-un clic) și, cu `copy`, butonul „Copiază”. */
export function GcsServerAddress({ address, copy: withButton = true }: { address: string; copy?: boolean }) {
  const t = useTranslations("servers");
  const { state, copy } = useCopy(address);
  return (
    <div className="gcs-serverAddress">
      <span className="gcs-serverAddress__text" data-testid="gcs-server-address">
        {address}
      </span>
      {withButton && (
        <>
          <button type="button" className={`gcs-btn gcs-btn--ghost${state === "ok" ? " gcs-serverCopied" : ""}`} onClick={() => void copy()} aria-label={`${t("copyAddress")}: ${address}`}>
            <GcsIconSvg icon={state === "ok" ? faCheck : faCopy} />
            {state === "ok" ? t("copied") : t("copy")}
          </button>
          <span role="status" className="gcs-srOnly">
            {state === "ok" ? t("copied") : state === "fail" ? t("copyFailed") : ""}
          </span>
        </>
      )}
    </div>
  );
}

/** Butonul „Copiază adresa” (acțiunea principală la jocurile fără Connect, ex. Minecraft). */
export function GcsCopyAddressButton({ address, variant = "primary", compact = false }: { address: string; variant?: "primary" | "ghost"; compact?: boolean }) {
  const t = useTranslations("servers");
  const { state, copy } = useCopy(address);
  const label = state === "ok" ? t("copied") : t("copyAddress");
  if (compact) {
    return (
      <button type="button" className="gcs-iconBtn" onClick={() => void copy()} aria-label={`${t("copyAddress")}: ${address}`} title={t("copyAddress")}>
        <GcsIconSvg icon={state === "ok" ? faCheck : faCopy} />
      </button>
    );
  }
  return (
    <button type="button" className={`gcs-btn gcs-btn--${variant}`} onClick={() => void copy()} data-testid="gcs-server-copy">
      <GcsIconSvg icon={state === "ok" ? faCheck : faCopy} />
      <span aria-live="polite">{label}</span>
    </button>
  );
}
