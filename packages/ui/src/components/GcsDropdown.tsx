"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cx } from "../cx";

export type GcsDropdownItem =
  | { kind: "link"; label: ReactNode; href: string; icon?: ReactNode; testId?: string }
  | { kind: "action"; label: ReactNode; onSelect: () => void; icon?: ReactNode; testId?: string }
  | { kind: "separator" }
  | { kind: "heading"; label: ReactNode };

export type GcsDropdownProps = {
  /** Conținutul butonului care deschide meniul. */
  trigger: ReactNode;
  /** Eticheta butonului pentru cititoarele de ecran. */
  label: string;
  items: GcsDropdownItem[];
  align?: "start" | "end";
  className?: string;
  triggerClassName?: string;
  testId?: string;
};

/**
 * Meniu dropdown accesibil (`role="menu"`): se deschide cu click, Enter sau săgeata în jos; săgețile, Home și End
 * mută focusul; Escape închide și readuce focusul pe buton; un click în afară îl închide.
 */
export function GcsDropdown({ trigger, label, items, align = "end", className, triggerClassName, testId }: GcsDropdownProps) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  const menuItems = () => [...(root.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
  const focusItem = (index: number) => {
    const list = menuItems();
    if (list.length === 0) return;
    list[(index + list.length) % list.length]!.focus();
  };

  useEffect(() => {
    if (!open) return;
    focusItem(0);
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const closeAndFocus = () => {
    setOpen(false);
    button.current?.focus();
  };

  return (
    <div
      ref={root}
      className={cx("gcs-dropdown", className)}
      onKeyDown={(e) => {
        if (!open) return;
        const list = menuItems();
        const current = list.indexOf(document.activeElement as HTMLElement);
        if (e.key === "Escape") {
          e.preventDefault();
          closeAndFocus();
        } else if (e.key === "ArrowDown") {
          e.preventDefault();
          focusItem(current + 1);
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          focusItem(current - 1);
        } else if (e.key === "Home") {
          e.preventDefault();
          focusItem(0);
        } else if (e.key === "End") {
          e.preventDefault();
          focusItem(list.length - 1);
        } else if (e.key === "Tab") {
          setOpen(false);
        }
      }}
    >
      <button
        ref={button}
        type="button"
        className={cx("gcs-dropdown__trigger", triggerClassName)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={label}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (!open && e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
          }
        }}
        data-testid={testId}
      >
        {trigger}
      </button>
      {open && (
        <div id={menuId} role="menu" aria-label={label} className={cx("gcs-dropdown__menu", `gcs-dropdown__menu--${align}`)}>
          {items.map((item, i) => {
            if (item.kind === "separator") return <div key={i} role="separator" className="gcs-dropdown__separator" />;
            if (item.kind === "heading")
              return (
                <div key={i} className="gcs-dropdown__heading" role="presentation">
                  {item.label}
                </div>
              );
            const content = (
              <>
                {item.icon && <span className="gcs-dropdown__icon">{item.icon}</span>}
                <span>{item.label}</span>
              </>
            );
            return item.kind === "link" ? (
              <a key={i} role="menuitem" tabIndex={-1} href={item.href} className="gcs-dropdown__item" onClick={() => setOpen(false)} data-testid={item.testId}>
                {content}
              </a>
            ) : (
              <button
                key={i}
                type="button"
                role="menuitem"
                tabIndex={-1}
                className="gcs-dropdown__item"
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
                data-testid={item.testId}
              >
                {content}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
