"use client";

import { cx } from "@gcs/ui";
import Link from "next/link";
import { useState, useTransition } from "react";
import { saveAppOrder } from "../actions";
import { ACP_APP_ICONS } from "./icons";
import type { GcsAcpNavApp } from "./types";

type Props = {
  apps: GcsAcpNavApp[];
  current: string | null;
  homeHref: string;
  labels: { appsNav: string; home: string; reorderApps: string; reorderDone: string; moveUp: Record<string, string>; moveDown: Record<string, string> };
};

/** Bara de aplicații ACP (96px). Ordinea se poate schimba (butoane sus/jos, accesibile din tastatură) și se salvează pe admin. */
export function GcsAcpAppRail({ apps, current, homeHref, labels }: Props) {
  const [order, setOrder] = useState(apps);
  const [editing, setEditing] = useState(false);
  const [, startTransition] = useTransition();

  function move(index: number, delta: -1 | 1) {
    const next = [...order];
    const [item] = next.splice(index, 1);
    next.splice(index + delta, 0, item!);
    setOrder(next);
    startTransition(() => {
      void saveAppOrder(next.map((a) => a.app));
    });
  }

  return (
    <nav aria-label={labels.appsNav} className="gcs-acpRail">
      <Link
        href={homeHref}
        aria-label={labels.home}
        style={{
          width: 44,
          height: 44,
          borderRadius: 10,
          background: "var(--gcs-accent)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transform: "skewX(-12deg)",
          marginBottom: 10,
          flexShrink: 0,
        }}
      >
        <span className="gcs-display" style={{ fontWeight: 700, fontSize: 22, color: "#fff", transform: "skewX(12deg)" }}>
          R
        </span>
      </Link>
      {order.map((a, i) => (
        <div key={a.app} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
          <Link
            href={a.href}
            className={cx("gcs-acpApp", a.app === current && "gcs-acpApp--active")}
            aria-current={a.app === current ? "page" : undefined}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d={ACP_APP_ICONS[a.app] ?? ACP_APP_ICONS.system} />
            </svg>
            <span>{a.label}</span>
          </Link>
          {editing && (
            <div style={{ display: "flex", gap: 2 }}>
              <button type="button" className="gcs-iconBtn" disabled={i === 0} aria-label={labels.moveUp[a.app]} onClick={() => move(i, -1)}>
                ↑
              </button>
              <button
                type="button"
                className="gcs-iconBtn"
                disabled={i === order.length - 1}
                aria-label={labels.moveDown[a.app]}
                onClick={() => move(i, 1)}
              >
                ↓
              </button>
            </div>
          )}
        </div>
      ))}
      <button
        type="button"
        className="gcs-iconBtn"
        aria-label={editing ? labels.reorderDone : labels.reorderApps}
        aria-pressed={editing}
        onClick={() => setEditing((v) => !v)}
        style={{ marginTop: "auto", width: 44, height: 44, flexShrink: 0 }}
      >
        {editing ? (
          "✓"
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M4 6h16M8 12h12M4 18h16" />
          </svg>
        )}
      </button>
    </nav>
  );
}
