"use client";

import { GcsButton, GcsHoverCard, type GcsHoverCardData, type GcsHoverCardLabels } from "@gcs/ui";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { followUser } from "../profile-actions";

type CardData = GcsHoverCardData & { viewer: { isSelf: boolean; isFollowing: boolean; canMessage: boolean; canFollow: boolean } };
type Labels = GcsHoverCardLabels & { follow: string; unfollow: string; message: string };

const OPEN_DELAY = 300;
const CLOSE_GRACE = 150;
const LONG_PRESS = 500;
const CLIENT_TTL = 5 * 60_000;
const WIDTH = 340;

/** Cache-ul din client (5 minute), comun tuturor cardurilor din pagină. `null` = profil invizibil. */
const cache = new Map<string, { at: number; data: CardData | null }>();

async function load(userId: string): Promise<CardData | null> {
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < CLIENT_TTL) return hit.data;
  const res = await fetch(`/api/users/${encodeURIComponent(userId)}/card`, { credentials: "same-origin" });
  const data = res.ok ? ((await res.json()) as CardData) : null;
  cache.set(userId, { at: Date.now(), data });
  return data;
}

type Open = { userId: string; anchor: HTMLElement; data: CardData; top: number; left: number };

function position(anchor: HTMLElement): { top: number; left: number } {
  const r = anchor.getBoundingClientRect();
  const left = Math.max(12, Math.min(r.left, window.innerWidth - WIDTH - 12));
  const below = r.bottom + 8;
  // Deasupra, dacă dedesubt nu e loc (cardul are ~300px).
  const top = below + 320 > window.innerHeight && r.top > 340 ? r.top - 328 : below;
  return { top, left };
}

/**
 * Hover card-ul pe orice nume de membru (`[data-user-id]`, spec §8): apare după 300 ms de hover sau focus,
 * rămâne deschis cât timp mouse-ul e pe el, se închide cu Escape. Pe ecrane tactile: apăsare lungă.
 */
export function GcsHoverCardHost({ labels, locale }: { labels: Labels; locale: string }) {
  const [open, setOpen] = useState<Open | null>(null);
  const [pending, startTransition] = useTransition();
  const openTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const suppressClick = useRef(false);
  /** După Escape, focusul revine pe link fără să redeschidă cardul. */
  const suppressFocus = useRef(false);
  const current = useRef<Open | null>(null);
  current.current = open;

  const cancelOpen = () => clearTimeout(openTimer.current);
  const scheduleClose = useCallback(() => {
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(null), CLOSE_GRACE);
  }, []);
  const keepOpen = () => clearTimeout(closeTimer.current);

  const show = useCallback((anchor: HTMLElement, delay: number) => {
    const userId = anchor.dataset.userId;
    if (!userId) return;
    clearTimeout(openTimer.current);
    keepOpen();
    if (current.current?.userId === userId) return;
    openTimer.current = setTimeout(async () => {
      const data = await load(userId).catch(() => null);
      if (!data || !anchor.isConnected) return;
      setOpen({ userId, anchor, data, ...position(anchor) });
    }, delay);
  }, []);

  useEffect(() => {
    const anchorOf = (e: Event) => (e.target instanceof Element ? (e.target.closest("[data-user-id]") as HTMLElement | null) : null);
    const inCard = (e: Event) => e.target instanceof Element && e.target.closest(".gcs-hoverCardLayer") !== null;
    const onOver = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      const a = anchorOf(e);
      if (a) show(a, OPEN_DELAY);
      else if (inCard(e)) keepOpen();
    };
    const onOut = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      if (anchorOf(e) || inCard(e)) {
        cancelOpen();
        scheduleClose();
      }
    };
    const onFocusIn = (e: FocusEvent) => {
      if (suppressFocus.current) {
        suppressFocus.current = false;
        return;
      }
      const a = anchorOf(e);
      if (a) show(a, OPEN_DELAY);
      else if (!inCard(e)) {
        cancelOpen();
        scheduleClose();
      }
    };
    let pressTimer: ReturnType<typeof setTimeout> | undefined;
    const onTouchStart = (e: TouchEvent) => {
      const a = anchorOf(e);
      if (!a) return;
      pressTimer = setTimeout(() => {
        suppressClick.current = true;
        show(a, 0);
      }, LONG_PRESS);
    };
    const onTouchEnd = () => clearTimeout(pressTimer);
    const onClick = (e: MouseEvent) => {
      if (suppressClick.current && anchorOf(e)) {
        e.preventDefault();
        suppressClick.current = false;
      } else if (current.current && !inCard(e)) {
        setOpen(null);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && current.current) {
        const anchor = current.current.anchor;
        cancelOpen();
        setOpen(null);
        suppressFocus.current = true;
        anchor.focus();
      }
    };
    const onScroll = () => setOpen(null);
    document.addEventListener("pointerover", onOver);
    document.addEventListener("pointerout", onOut);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchend", onTouchEnd);
    document.addEventListener("touchmove", onTouchEnd, { passive: true });
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      document.removeEventListener("pointerover", onOver);
      document.removeEventListener("pointerout", onOut);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchend", onTouchEnd);
      document.removeEventListener("touchmove", onTouchEnd);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll);
    };
  }, [show, scheduleClose]);

  if (!open) return null;
  const { data } = open;
  const number = (n: number) => new Intl.NumberFormat(locale).format(n);
  const year = (iso: string) => String(new Date(iso).getFullYear());

  const toggleFollow = () =>
    startTransition(async () => {
      const res = await followUser({ userId: open.userId, follow: !data.viewer.isFollowing });
      if (!res.ok) return;
      const next: CardData = { ...data, stats: { ...data.stats, followers: res.data.followers }, viewer: { ...data.viewer, isFollowing: res.data.following } };
      cache.set(open.userId, { at: Date.now(), data: next });
      setOpen((o) => (o ? { ...o, data: next } : o));
    });

  const actions =
    data.viewer.canFollow || data.viewer.canMessage ? (
      <>
        {data.viewer.canFollow && (
          <GcsButton variant={data.viewer.isFollowing ? "ghost" : "primary"} onClick={toggleFollow} disabled={pending} data-testid="gcs-hover-follow">
            {data.viewer.isFollowing ? labels.unfollow : labels.follow}
          </GcsButton>
        )}
        {data.viewer.canMessage && (
          <GcsButton variant="ghost" asChild>
            <Link href={`/messages/new?to=${encodeURIComponent(open.userId)}`}>{labels.message}</Link>
          </GcsButton>
        )}
      </>
    ) : undefined;

  return (
    <div className="gcs-hoverCardLayer" style={{ top: open.top, left: open.left }} onPointerEnter={keepOpen} onPointerLeave={scheduleClose}>
      <GcsHoverCard data={data} labels={labels} format={{ number, year }} actions={actions} />
    </div>
  );
}
