"use client";

import { faEye, faEyeSlash, faTrashCan } from "@fortawesome/free-regular-svg-icons";
import { faArrowRight, faChevronDown } from "@fortawesome/free-solid-svg-icons";
import type { GcsChatMessageView, GcsChatSystemLine } from "@gcs/modules";
import { GcsButton, GcsIconSvg, GcsModal, gcsToast } from "@gcs/ui";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { useErrorMessage } from "@/lib/use-error-message";
import { deleteChatMessage, hideChatMessage } from "../../chat-actions";
import { GcsChatSystemText } from "../chat/GcsChatModeration";
import { useDismiss } from "../chat/use-dismiss";

/** „Pagina X din N ▾”: popover-ul „Sari la pagina” (câmp + Mergi). */
export function GcsHistoryJump({ page, pages, base }: { page: number; pages: number; base: string }) {
  const t = useTranslations("chatPro.historyPage");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(String(page));
  const box = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, box, close, trigger);
  const go = () => {
    const n = Math.min(pages, Math.max(1, Math.trunc(Number(value)) || 1));
    setOpen(false);
    router.push(`${base}${base.includes("?") ? "&" : "?"}page=${n}`);
  };
  return (
    <span className="gcs-chHist__jumpWrap">
      <button ref={trigger} type="button" className="gcs-chHist__pg gcs-chHist__pg--select gcs-sweep" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(!open)} data-testid="gcs-chat-history-jump">
        {t("page", { page, pages })}
        <GcsIconSvg icon={faChevronDown} />
      </button>
      {open && (
        <div ref={box} className="gcs-chHist__jump" role="dialog" aria-label={t("jumpTitle")}>
          <span className="gcs-chHist__label">{t("jumpTitle")}</span>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              go();
            }}
          >
            <input className="gcs-input" type="number" min={1} max={pages} value={value} onChange={(e) => setValue(e.target.value)} aria-label={t("jumpTitle")} autoFocus data-testid="gcs-chat-history-jump-input" />
            <button type="submit" className="gcs-chHist__btn gcs-sweep" data-testid="gcs-chat-history-jump-go">
              {t("go")}
            </button>
          </form>
        </div>
      )}
    </span>
  );
}

/** Chip-ul „#ID”: copiază linkul mesajului (camera se deschide în jurul lui). */
export function GcsHistoryIdChip({ id, href }: { id: number; href: string }) {
  const t = useTranslations("chatPro.historyPage");
  return (
    <button
      type="button"
      className="gcs-chHist__id gcs-sweep"
      title={t("copyLink")}
      onClick={() =>
        void navigator.clipboard?.writeText(`${location.origin}${href}`).then(
          () => gcsToast({ title: t("copied") }),
          () => undefined,
        )
      }
      data-testid="gcs-chat-history-id"
    >
      #{id}
    </button>
  );
}

/** Acțiunile unui rând, la hover: ascunde / arată (staff), șterge (staff, cu confirmare), „Vezi în chat”. */
export function GcsHistoryActions({ id, hidden, canHide, canDelete, href }: { id: number; hidden: boolean; canHide: boolean; canDelete: boolean; href: string }) {
  const t = useTranslations("chatPro.historyPage");
  const tc = useTranslations("chat.mod");
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const run = async (p: Promise<{ ok: boolean; error?: unknown }>) => {
    setBusy(true);
    const r = await p;
    setBusy(false);
    if (!r.ok) gcsToast({ title: errorMessage(r.error as never) });
    else router.refresh();
  };
  return (
    <span className="gcs-chHist__acts">
      {canHide && (
        <button type="button" className="gcs-chHist__act gcs-sweep" title={hidden ? tc("unhide") : tc("hide")} aria-label={hidden ? tc("unhide") : tc("hide")} disabled={busy} onClick={() => void run(hideChatMessage({ id, hidden: !hidden }))} data-testid="gcs-chat-history-hide">
          <GcsIconSvg icon={hidden ? faEye : faEyeSlash} />
        </button>
      )}
      {canDelete && (
        <button type="button" className="gcs-chHist__act gcs-chHist__act--danger gcs-sweep" title={tc("delete")} aria-label={tc("delete")} disabled={busy} onClick={() => setConfirm(true)} data-testid="gcs-chat-history-delete">
          <GcsIconSvg icon={faTrashCan} />
        </button>
      )}
      <a href={href} className="gcs-chHist__act gcs-sweep" title={t("viewInChat")} aria-label={t("viewInChat")} data-testid="gcs-chat-history-view">
        <GcsIconSvg icon={faArrowRight} />
      </a>
      {confirm && (
        <GcsModal title={t("deleteTitle")} onClose={() => setConfirm(false)} closeLabel={tc("cancel")} size="sm">
          <p>{t("deleteBody")}</p>
          <div className="gcs-dialog__actions">
            <GcsButton variant="ghost" onClick={() => setConfirm(false)}>
              {tc("cancel")}
            </GcsButton>
            <GcsButton
              variant="primary"
              className="gcs-chatModDialog__danger"
              disabled={busy}
              onClick={() => {
                setConfirm(false);
                void run(deleteChatMessage({ id }));
              }}
            >
              {tc("delete")}
            </GcsButton>
          </div>
        </GcsModal>
      )}
    </span>
  );
}

/** O linie de sistem a moderării, în istoric. */
export function GcsHistorySystem({ system, author, deletedMember }: { system: GcsChatSystemLine; author: GcsChatMessageView["author"]; deletedMember: string }) {
  return (
    <span className="gcs-chHist__system">
      <GcsChatSystemText system={system} author={author} deletedMember={deletedMember} />
    </span>
  );
}
