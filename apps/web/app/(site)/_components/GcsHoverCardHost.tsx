"use client";

import { faEnvelope, faUserMinus, faUserPlus } from "@fortawesome/free-solid-svg-icons";
import { GcsButton, GcsHoverCard, GcsIconSvg, placeHoverCard, type GcsHoverCardData, type GcsHoverCardLabels, type GcsHoverCardPlacement } from "@gcs/ui";
import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { followUser } from "../profile-actions";

/** `html`: markup-ul din șablonul `members.hover_card` al temei (deja sanitizat pe server), dacă tema l-a modificat. */
type CardData = GcsHoverCardData & { viewer: { isSelf: boolean; isFollowing: boolean; canMessage: boolean; canFollow: boolean }; html?: string | null };
type Labels = GcsHoverCardLabels & { follow: string; unfollow: string; message: string };

const OPEN_DELAY = 300;
const CLOSE_GRACE = 150;
const LONG_PRESS = 500;
const CLIENT_TTL = 5 * 60_000;

/** Cache-ul din client (5 minute), comun tuturor cardurilor din pagină. `null` = profil invizibil. */
const cache = new Map<string, { at: number; data: CardData | null }>();

async function load(userId: string, fresh = false): Promise<CardData | null> {
  const hit = cache.get(userId);
  if (!fresh && hit && Date.now() - hit.at < CLIENT_TTL) return hit.data;
  const res = await fetch(`/api/users/${encodeURIComponent(userId)}/card`, { credentials: "same-origin" });
  const data = res.ok ? ((await res.json()) as CardData) : null;
  cache.set(userId, { at: Date.now(), data });
  return data;
}

type Open = { userId: string; anchor: HTMLElement; data: CardData };

/**
 * Cardul din șablonul temei: HTML-ul sanitizat pe server (fără scripturi sau atribute `on*`), cu butoanele React puse
 * în slotul `actions` printr-un portal (sau sub card, dacă șablonul nu are slotul).
 */
function TemplatedCard({ html, actions }: { html: string; actions: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [slot, setSlot] = useState<Element | null>(null);
  useLayoutEffect(() => {
    setSlot(box.current?.querySelector('gcs-slot[data-name="actions"]') ?? null);
  }, [html]);
  return (
    <>
      <div ref={box} style={{ display: "contents" }} dangerouslySetInnerHTML={{ __html: html }} />
      {actions && (slot ? createPortal(actions, slot) : <div className="gcs-hoverCard__actions">{actions}</div>)}
    </>
  );
}

/**
 * Hover card-ul pe orice nume de membru (`[data-user-id]`, spec §8): apare după 300 ms de hover sau focus,
 * rămâne deschis cât timp mouse-ul e pe el, se închide cu Escape. Pe ecrane tactile: apăsare lungă.
 */
export function GcsHoverCardHost({ labels, locale }: { labels: Labels; locale: string }) {
  const [open, setOpen] = useState<Open | null>(null);
  /** Locul cardului, calculat după mărimea lui măsurată; `null` = încă nemăsurat (stratul e ascuns). */
  const [place, setPlace] = useState<GcsHoverCardPlacement | null>(null);
  const layer = useRef<HTMLDivElement>(null);
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
      setPlace(null);
      setOpen({ userId, anchor, data });
    }, delay);
  }, []);

  // Așezarea: după desenarea ascunsă, înainte de afișare (fără pâlpâire), apoi la orice schimbare de mărime a cardului
  // (conținut încărcat, butonul „Urmărește” schimbat, șablonul temei) și a ferestrei. Stratul e `position: fixed`,
  // deci coordonatele sunt ale viewport-ului (ca `getBoundingClientRect()`), indiferent de scroll.
  useLayoutEffect(() => {
    const el = layer.current;
    if (!open || !el) return;
    const update = () => {
      if (!open.anchor.isConnected) return;
      const next = placeHoverCard(open.anchor.getBoundingClientRect(), { width: el.offsetWidth, height: el.offsetHeight }, { width: document.documentElement.clientWidth, height: window.innerHeight });
      setPlace((p) => (p && p.top === next.top && p.left === next.left && p.side === next.side ? p : next));
    };
    update();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(el);
    window.addEventListener("resize", update);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [open]);

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
      let next: CardData = { ...data, stats: { ...data.stats, followers: res.data.followers }, viewer: { ...data.viewer, isFollowing: res.data.following } };
      // Cardul din șablon e randat pe server: îl cerem din nou, cu numărul nou de urmăritori.
      if (data.html) next = (await load(open.userId, true).catch(() => null)) ?? next;
      cache.set(open.userId, { at: Date.now(), data: next });
      setOpen((o) => (o ? { ...o, data: next } : o));
    });

  const actions =
    data.viewer.canFollow || data.viewer.canMessage ? (
      <>
        {data.viewer.canFollow && (
          <GcsButton
            variant={data.viewer.isFollowing ? "ghost" : "primary"}
            icon={<GcsIconSvg icon={data.viewer.isFollowing ? faUserMinus : faUserPlus} />}
            onClick={toggleFollow}
            disabled={pending}
            data-testid="gcs-hover-follow"
          >
            {data.viewer.isFollowing ? labels.unfollow : labels.follow}
          </GcsButton>
        )}
        {data.viewer.canMessage && (
          <GcsButton variant="ghost" asChild icon={<GcsIconSvg icon={faEnvelope} />}>
            <Link href={`/messages/new?to=${encodeURIComponent(open.userId)}`}>{labels.message}</Link>
          </GcsButton>
        )}
      </>
    ) : undefined;

  return (
    <div
      ref={layer}
      className="gcs-hoverCardLayer"
      style={{ top: place?.top ?? 0, left: place?.left ?? 0 }}
      data-side={place?.side ?? "pending"}
      onPointerEnter={keepOpen}
      onPointerLeave={scheduleClose}
    >
      {data.html ? <TemplatedCard html={data.html} actions={actions} /> : <GcsHoverCard data={data} labels={labels} format={{ number, year }} actions={actions} />}
    </div>
  );
}
