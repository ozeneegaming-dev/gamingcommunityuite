"use client";

import {
  faAward,
  faBan,
  faCalendarPlus,
  faCheck,
  faCircleCheck,
  faCircleMinus,
  faCrown,
  faEyeSlash,
  faFloppyDisk,
  faGavel,
  faPlus,
  faRotate,
  faRotateLeft,
  faTrash,
  faTriangleExclamation,
  faUnlock,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import type { GcsResult } from "@gcs/core";
import { GcsButton, GcsIconSvg, type GcsIconSvgProps } from "@gcs/ui";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { useErrorMessage } from "@/lib/use-error-message";
import { GcsConfirmDialog } from "./GcsConfirmDialog";

/** Iconițele butonului de trimitere după tipul acțiunii (se pot folosi și din componentele server, ca text). */
const SUBMIT_ICONS = {
  save: faFloppyDisk,
  create: faPlus,
  delete: faTrash,
  lift: faUnlock,
  remove: faXmark,
  approve: faCheck,
  reject: faBan,
  hide: faEyeSlash,
  close: faCircleCheck,
  reset: faRotateLeft,
  recompute: faRotate,
  revoke: faCircleMinus,
  award: faAward,
  grant: faCrown,
  extend: faCalendarPlus,
  ban: faGavel,
  warn: faTriangleExclamation,
} satisfies Record<string, GcsIconSvgProps["icon"]>;

export type GcsActionKind = keyof typeof SUBMIT_ICONS;

type Props = {
  action: (fd: FormData) => Promise<GcsResult<unknown>>;
  submitLabel: string;
  /** Tipul acțiunii: alege iconița Font Awesome a butonului (salvează, adaugă, șterge…). */
  submitKind?: GcsActionKind;
  /** O iconiță proprie pentru buton (are prioritate față de `submitKind`). */
  submitIcon?: ReactNode;
  variant?: "primary" | "ghost";
  children?: ReactNode;
  style?: CSSProperties;
  /** Unde merge pagina după succes; implicit se reîncarcă datele paginii curente. */
  redirectTo?: string;
  /** Pentru butoanele de un singur rând (ex. „Scoate grupul”), fără mesaj de succes. */
  compact?: boolean;
  confirm?: string;
};

export { useErrorMessage } from "@/lib/use-error-message";

/** Un formular ACP legat de o Server Action care întoarce `GcsResult`: afișează „Salvat” sau eroarea. */
export function GcsActionForm({ action, submitLabel, submitKind, submitIcon, variant = "primary", children, style, redirectTo, compact, confirm }: Props) {
  const router = useRouter();
  const t = useTranslations("acp");
  const errorMessage = useErrorMessage();
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, setPending] = useState(false);

  // Confirmarea în pagină (niciodată `window.confirm`): formularul așteaptă „Confirmă” din dialog.
  const [asking, setAsking] = useState<FormData | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    if (confirm) {
      setAsking(fd);
      return;
    }
    await run(fd);
  }

  async function run(fd: FormData) {
    setPending(true);
    setStatus(null);
    const result = await action(fd);
    setPending(false);
    if (!result.ok) return setStatus({ ok: false, text: errorMessage(result.error) });
    if (!compact) setStatus({ ok: true, text: t("saved") });
    if (redirectTo) router.push(redirectTo);
    else router.refresh();
  }

  return (
    <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: compact ? "row" : "column", gap: compact ? 8 : 14, ...style }}>
      {children}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <GcsButton
          variant={variant}
          size={compact ? "sm" : "md"}
          type="submit"
          disabled={pending}
          icon={submitIcon ?? (submitKind ? <GcsIconSvg icon={SUBMIT_ICONS[submitKind]} /> : undefined)}
        >
          {submitLabel}
        </GcsButton>
        {status && (
          <span
            role={status.ok ? "status" : "alert"}
            style={{ fontSize: 13, fontWeight: 600, color: status.ok ? "var(--gcs-ok)" : "#FF8A91" }}
          >
            {status.text}
          </span>
        )}
      </div>
      {asking && confirm && (
        <GcsConfirmDialog
          title={submitLabel}
          body={confirm}
          confirmLabel={submitLabel}
          danger={submitKind === "delete" || submitKind === "ban" || submitKind === "remove" || submitKind === "revoke"}
          busy={pending}
          onCancel={() => setAsking(null)}
          onConfirm={() => {
            const fd = asking;
            setAsking(null);
            void run(fd);
          }}
        />
      )}
    </form>
  );
}
