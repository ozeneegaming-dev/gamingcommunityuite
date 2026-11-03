"use client";

import { faEllipsis } from "@fortawesome/free-solid-svg-icons";
import { GcsButton, GcsDropdown, GcsIconSvg, GcsModal, type GcsDropdownItem } from "@gcs/ui";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";

/** Un popup al fișei membrului: titlul, iconița și conținutul (formularele randate pe server). */
export type GcsMemberModal = { title: string; icon?: ReactNode; size?: "sm" | "md" | "lg"; body: ReactNode };

/** O intrare din „Mai multe”: deschide un popup, merge la o pagină (unire, export) sau desparte grupurile. */
export type GcsMemberMenuItem =
  | { kind: "modal"; which: string; label: string; icon?: ReactNode; testId?: string }
  | { kind: "link"; href: string; label: string; icon?: ReactNode; testId?: string }
  | { kind: "separator" };

const MemberActions = createContext<{ open: (which: string) => void } | null>(null);

const FIELD = 'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled])';

/**
 * Popupurile fișei membrului (ACP › Membri › membrul): bara de acțiuni, „Mai multe” și legăturile din carduri deschid
 * același popup după cheie (`groups`, `warn`, `ban`…), cu formularul acțiunii înăuntru. Formularul principal închide
 * popupul după o salvare reușită (rândurile compacte, ca „Anulează” sau „Ridică bannul”, îl lasă deschis), iar o
 * confirmare deschisă peste popup se închide prima la Escape. `initial` deschide un popup de la încărcare (ex.
 * „Ban pe site…” din chat, `?ban=1`).
 */
export function GcsMemberActions({ modals, initial, closeLabel, children }: { modals: Record<string, GcsMemberModal>; initial?: string | null; closeLabel: string; children: ReactNode }) {
  const [current, setCurrent] = useState<string | null>(initial && modals[initial] ? initial : null);
  const body = useRef<HTMLDivElement>(null);
  const modal = current ? modals[current] : undefined;

  useEffect(() => {
    const el = body.current;
    if (!current || !el) return;
    // Focusul pe primul câmp (sau pe butonul acțiunii, la popupurile care doar confirmă), nu pe „Închide”.
    (el.querySelector<HTMLElement>(FIELD) ?? el.querySelector<HTMLElement>(".gcs-actionForm__actions button"))?.focus();
    // „Salvat” apare doar la formularele principale (cele compacte nu-l afișează): atunci popupul și-a făcut treaba.
    const observer = new MutationObserver(() => {
      if (el.querySelector('.gcs-actionForm__actions > [role="status"]')) setCurrent(null);
    });
    observer.observe(el, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [current]);

  const close = () => {
    // Confirmarea unei acțiuni din popup (un al doilea dialog) se închide singură; popupul rămâne.
    if (document.querySelectorAll(".gcs-modal").length > 1) return;
    setCurrent(null);
  };

  return (
    <MemberActions.Provider value={{ open: setCurrent }}>
      {children}
      {modal && current && (
        <GcsModal title={modal.title} icon={modal.icon} size={modal.size ?? "md"} closeLabel={closeLabel} onClose={close} className="gcs-mpModal">
          <div ref={body} className="gcs-mpModal__body" data-testid={`gcs-member-modal-${current}`}>
            {modal.body}
          </div>
        </GcsModal>
      )}
    </MemberActions.Provider>
  );
}

/** Un buton din bara de acțiuni care deschide popupul `which`. */
export function GcsMemberActionButton({ which, label, icon, testId }: { which: string; label: string; icon?: ReactNode; testId?: string }) {
  const ctx = useContext(MemberActions);
  return (
    <GcsButton variant="ghost" size="sm" icon={icon} aria-haspopup="dialog" onClick={() => ctx?.open(which)} data-testid={testId}>
      {label}
    </GcsButton>
  );
}

/** Legătura din titlul unui card („Gestionează”, „Avertizează”…): deschide același popup ca bara de acțiuni. */
export function GcsMemberCardAction({ which, label, testId }: { which: string; label: string; testId?: string }) {
  const ctx = useContext(MemberActions);
  return (
    <button type="button" className="gcs-mpCard__action" aria-haspopup="dialog" onClick={() => ctx?.open(which)} data-testid={testId}>
      {label}
    </button>
  );
}

/** „Mai multe”: acțiunile rare ale contului, într-un meniu accesibil (săgeți, Escape, click în afară). */
export function GcsMemberMoreMenu({ label, items, testId }: { label: string; items: GcsMemberMenuItem[]; testId?: string }) {
  const ctx = useContext(MemberActions);
  const menu = items.map((item): GcsDropdownItem => {
    if (item.kind === "separator") return item;
    const icon = item.icon ? { icon: item.icon } : {};
    const id = item.testId ? { testId: item.testId } : {};
    if (item.kind === "link") return { kind: "link", label: item.label, href: item.href, ...icon, ...id };
    return { kind: "action", label: item.label, onSelect: () => ctx?.open(item.which), ...icon, ...id };
  });
  return (
    <GcsDropdown
      label={label}
      align="start"
      className="gcs-mpBar__moreWrap"
      triggerClassName="gcs-btn gcs-btn--ghost gcs-btn--sm gcs-mpBar__more"
      testId={testId}
      items={menu}
      trigger={
        <>
          <span className="gcs-btn__icon" aria-hidden="true">
            <GcsIconSvg icon={faEllipsis} />
          </span>
          {label}
        </>
      }
    />
  );
}
