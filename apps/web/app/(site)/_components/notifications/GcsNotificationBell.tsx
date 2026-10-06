"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { GcsNotificationItem } from "@/lib/notifications";
import { markNotificationsRead } from "../../notification-actions";
import { useRealtime } from "../realtime/GcsRealtimeProvider";

type Labels = { title: string; unread: string; empty: string; markAll: string; seeAll: string };

const badge = (n: number) => (n > 99 ? "99+" : String(n));

/**
 * Clopoțelul din header (specul etapei 4 §8): numărul vine de pe server și se actualizează live (`notification`,
 * `resync`); lista se încarcă la deschidere. Click pe o notificare → citită + navigare.
 */
export function GcsNotificationBell({ initialUnread, labels }: { initialUnread: number; labels: Labels }) {
  const [unread, setUnread] = useState(initialUnread);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<GcsNotificationItem[] | null>(null);
  const realtime = useRealtime();
  const router = useRouter();
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async (countOnly: boolean) => {
    const res = await fetch(`/api/notifications${countOnly ? "?count=1" : ""}`, { cache: "no-store" }).catch(() => null);
    if (!res?.ok) return;
    const body = (await res.json()) as { unread: number; items: GcsNotificationItem[] };
    setUnread(body.unread);
    if (!countOnly) setItems(body.items);
  }, []);

  useEffect(() => setUnread(initialUnread), [initialUnread]);

  useEffect(() => {
    const offLive = realtime.on("notification", (data) => {
      const n = (data as { unread?: unknown } | null)?.unread;
      if (typeof n === "number") setUnread(n);
      setItems(null);
    });
    const offResync = realtime.on("resync", () => void load(true));
    return () => {
      offLive();
      offResync();
    };
  }, [realtime, load]);

  useEffect(() => {
    if (open && items === null) void load(false);
  }, [open, items, load]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onClick = (e: MouseEvent) => !rootRef.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  const openItem = async (item: GcsNotificationItem) => {
    setOpen(false);
    if (!item.read) {
      const res = await markNotificationsRead({ ids: [item.id] });
      if (res.ok) setUnread(res.data.unread);
      setItems((list) => list?.map((i) => (i.id === item.id ? { ...i, read: true } : i)) ?? null);
    }
    router.push(item.href);
  };

  const markAll = async () => {
    const res = await markNotificationsRead({ ids: "all" });
    if (res.ok) setUnread(res.data.unread);
    setItems((list) => list?.map((i) => ({ ...i, read: true })) ?? null);
  };

  return (
    <div ref={rootRef} style={{ position: "relative" }}>
      <button
        type="button"
        className="gcs-headerIcon"
        aria-label={unread > 0 ? labels.unread.replace("{count}", String(unread)) : labels.title}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        data-testid="gcs-header-bell"
      >
        <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {unread > 0 && (
          <span className="gcs-headerIcon__count" data-testid="gcs-header-bell-count">
            {badge(unread)}
          </span>
        )}
      </button>
      {open && (
        <div id={panelId} role="dialog" aria-label={labels.title} className="gcs-notifPanel" data-testid="gcs-notif-panel">
          <div className="gcs-notifPanel__head">
            <strong>{labels.title}</strong>
            {unread > 0 && (
              <button type="button" className="gcs-linkButton" onClick={() => void markAll()}>
                {labels.markAll}
              </button>
            )}
          </div>
          {items === null ? (
            <p className="gcs-notifPanel__empty" aria-busy="true">
              …
            </p>
          ) : items.length === 0 ? (
            <p className="gcs-notifPanel__empty">{labels.empty}</p>
          ) : (
            <ul className="gcs-notifPanel__list">
              {items.map((item) => (
                <li key={item.id}>
                  <a
                    href={item.href}
                    className={`gcs-notifItem${item.read ? "" : " gcs-notifItem--unread"}`}
                    onClick={(e) => {
                      e.preventDefault();
                      void openItem(item);
                    }}
                  >
                    <span className="gcs-notifItem__text">{item.text}</span>
                    {item.snippet && <span className="gcs-notifItem__snippet">{item.snippet}</span>}
                    <time className="gcs-notifItem__time" dateTime={item.updatedAt}>
                      {new Date(item.updatedAt).toLocaleString()}
                    </time>
                  </a>
                </li>
              ))}
            </ul>
          )}
          <Link href="/notifications" className="gcs-notifPanel__all" onClick={() => setOpen(false)}>
            {labels.seeAll}
          </Link>
        </div>
      )}
    </div>
  );
}

/** Un număr din header actualizat live (ex. plicul mesajelor: evenimentul `pm`). */
export function GcsLiveCount({ initial, event, testId }: { initial: number; event: string; testId: string }) {
  const [count, setCount] = useState(initial);
  const realtime = useRealtime();
  useEffect(() => setCount(initial), [initial]);
  useEffect(
    () =>
      realtime.on(event, (data) => {
        const n = (data as { unread?: unknown } | null)?.unread;
        if (typeof n === "number") setCount(n);
      }),
    [realtime, event],
  );
  if (count <= 0) return null;
  return (
    <span className="gcs-headerIcon__count" data-testid={testId}>
      {badge(count)}
    </span>
  );
}
