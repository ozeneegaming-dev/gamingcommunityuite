"use client";

import { faBan, faEnvelope, faFileLines, faUserMinus, faUserPlus } from "@fortawesome/free-solid-svg-icons";
import {
  GcsButton,
  GcsGroupCard,
  GcsHoverCard,
  GcsHoverCardActions,
  GcsHoverCardIconAction,
  GcsIconSvg,
  hoverCardArrowX,
  placeHoverCard,
  type GcsGroupCardData,
  type GcsGroupCardLabels,
  type GcsHoverCardData,
  type GcsHoverCardLabels,
  type GcsHoverCardPlacement,
  type GcsHoverCardV2,
  type GcsHoverCardV2Labels,
} from "@gcs/ui";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useTransition, type CSSProperties, type ReactNode, type TouchEvent as ReactTouchEvent } from "react";
import { createPortal } from "react-dom";
import { avatarAnchorOf, hoverAnchorKey, hoverAnchorOf, OPEN_CARD_EVENT } from "@/lib/hover-anchor";
import { hoverCardActionProviders } from "@/lib/hover-card-actions";
import { followUser, ignoreUser } from "../profile-actions";

/**
 * `html`: markup-ul din șablonul `members.hover_card` al temei (deja sanitizat pe server), dacă tema l-a modificat.
 * Câmpurile bogate (nivelul, emblema rangului, statusul, cipurile, „Conținutul lui”, Ignoră) vin din `GcsHoverCardLoader`.
 */
type CardData = GcsHoverCardData &
  Partial<Pick<GcsHoverCardV2, "level" | "status" | "chips" | "profileHref" | "rankEmblem">> & {
    viewer: { isSelf: boolean; isFollowing: boolean; canMessage: boolean; canFollow: boolean; isIgnored?: boolean; canIgnore?: boolean };
    contentHref?: string;
    html?: string | null;
  };
type Labels = GcsHoverCardLabels & { follow: string; unfollow: string; message: string; group: GcsGroupCardLabels };

const OPEN_DELAY = 300;
const CLOSE_GRACE = 150;
const LONG_PRESS = 500;
const CLIENT_TTL = 5 * 60_000;
/** Cardul unui grup (membrii online se schimbă des): păstrat mai puțin în client. */
const GROUP_TTL = 60_000;
/** O atingere de acum cel mult atât (ms): clickul care urmează vine de pe un ecran tactil. */
const TOUCH_RECENT = 800;
/** Telefonul: cardul deschis prin atingere devine foaie de jos. */
const SHEET_MEDIA = "(max-width: 760px)";
/** Glisarea în jos (px) care închide foaia. */
const SWIPE_CLOSE = 90;
/** Ce poate primi focusul în card (ordinea Tab-ului). */
const FOCUSABLE = "a[href], button:not(:disabled), [tabindex]:not([tabindex='-1'])";

/** Cache-ul din client (5 minute), comun tuturor cardurilor din pagină. `null` = profil invizibil. */
const cache = new Map<string, { at: number; data: CardData | null }>();
const groupCache = new Map<string, { at: number; data: GcsGroupCardData | null }>();

async function loadGroup(groupId: string): Promise<GcsGroupCardData | null> {
  const hit = groupCache.get(groupId);
  if (hit && Date.now() - hit.at < GROUP_TTL) return hit.data;
  const res = await fetch(`/api/groups/${encodeURIComponent(groupId)}/card`, { credentials: "same-origin" });
  const data = res.ok ? ((await res.json()) as GcsGroupCardData) : null;
  groupCache.set(groupId, { at: Date.now(), data });
  return data;
}

async function load(userId: string, fresh = false): Promise<CardData | null> {
  const hit = cache.get(userId);
  if (!fresh && hit && Date.now() - hit.at < CLIENT_TTL) return hit.data;
  const res = await fetch(`/api/users/${encodeURIComponent(userId)}/card`, { credentials: "same-origin" });
  const data = res.ok ? ((await res.json()) as CardData) : null;
  cache.set(userId, { at: Date.now(), data });
  return data;
}

/** `popover`: lângă nume (mouse, tastatură); `sheet`: foaia de jos de pe telefon (atingere). */
type Mode = "popover" | "sheet";
type Source = "pointer" | "focus" | "touch";
type Open =
  | { kind: "user"; key: string; userId: string; anchor: HTMLElement; data: CardData; mode: Mode }
  | { kind: "group"; key: string; groupId: string; anchor: HTMLElement; data: GcsGroupCardData; mode: Mode };
/** Locul cardului lângă nume și locul săgeții (px de la marginea lui stângă). */
type Place = GcsHoverCardPlacement & { arrow: number };

const HEX = /^#[0-9a-f]{6}$/i;
/** Culoarea cardului unui membru (săgeata de lângă coperta-degrade): a grupului afișat, apoi accentul membrului. */
function toneOf(open: Open): string | null {
  if (open.kind !== "user" || open.data.html) return null;
  const { group, accentColor } = open.data.user;
  return [group.color, accentColor].find((c): c is string => typeof c === "string" && HEX.test(c)) ?? null;
}

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
 * Hover card-ul pe orice nume de membru (`[data-user-id]`, spec §8) și pe @mențiuni (membri și grupuri, Mențiuni v2):
 * apare după 300 ms de hover sau focus, lângă nume, cu o săgeată spre el; rămâne deschis cât timp mouse-ul e pe el, se
 * închide cu Escape. Pe telefon (≤ 760 px, atingere): atingerea unui avatar sau apăsarea lungă pe un nume deschide
 * cardul ca foaie de jos (fundal întunecat; atingerea fundalului, glisarea în jos sau Escape o închid; focusul rămâne
 * în ea); atingerea numelui merge tot la profil.
 */
export function GcsHoverCardHost({ labels, locale }: { labels: Labels; locale: string }) {
  const t = useTranslations("hoverCard");
  const [open, setOpen] = useState<Open | null>(null);
  /** Locul cardului, calculat după mărimea lui măsurată; `null` = încă nemăsurat (stratul e ascuns). */
  const [place, setPlace] = useState<Place | null>(null);
  const layer = useRef<HTMLDivElement>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** După o apăsare lungă care a deschis cardul: clickul de la ridicarea degetului nu navighează și nu închide nimic. */
  const pressFired = useRef(false);
  const suppressClickUntil = useRef(0);
  /** Momentul ultimei atingeri (clickul care urmează vine de pe ecranul tactil). */
  const lastTouch = useRef(0);
  /** După Escape, focusul revine pe link fără să redeschidă cardul. */
  const suppressFocus = useRef(false);
  const current = useRef<Open | null>(null);
  current.current = open;
  /** Ancora a cărei deschidere așteaptă (întârzierea de 300 ms). */
  const pending = useRef<HTMLElement | null>(null);
  /** De unde a venit ultima cerere de deschidere: mouse-ul (sau atingerea) ori focusul din tastatură. */
  const pendingSource = useRef<"pointer" | "focus">("pointer");
  /** Glisarea foii de jos: unde a început atingerea și cât a coborât. */
  const drag = useRef<{ y: number; dy: number } | null>(null);

  const cancelOpen = () => clearTimeout(openTimer.current);
  const scheduleClose = useCallback(() => {
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(null), CLOSE_GRACE);
  }, []);
  const keepOpen = () => clearTimeout(closeTimer.current);

  const show = useCallback((anchor: HTMLElement, delay: number, source: Source = "pointer") => {
    const key = hoverAnchorKey(anchor);
    if (!key) return;
    clearTimeout(openTimer.current);
    keepOpen();
    const mode: Mode = source === "touch" && window.matchMedia(SHEET_MEDIA).matches ? "sheet" : "popover";
    if (current.current?.key === key && current.current.mode === mode) return;
    pending.current = anchor;
    pendingSource.current = source === "focus" ? "focus" : "pointer";
    openTimer.current = setTimeout(async () => {
      const id = key.slice(2);
      if (key.startsWith("g:")) {
        const data = await loadGroup(id).catch(() => null);
        if (!data || !anchor.isConnected) return;
        setPlace(null);
        setOpen({ kind: "group", key, groupId: id, anchor, data, mode });
        return;
      }
      const data = await load(id).catch(() => null);
      if (!data || !anchor.isConnected) return;
      setPlace(null);
      setOpen({ kind: "user", key, userId: id, anchor, data, mode });
    }, delay);
  }, []);

  /** Focusul înapoi pe ancoră (numele), fără să redeschidă cardul; un avatar (fără focus) nu-l primește. */
  const refocus = useCallback((anchor: HTMLElement) => {
    suppressFocus.current = true;
    anchor.focus();
    if (document.activeElement !== anchor) suppressFocus.current = false;
  }, []);

  // Așezarea: după desenarea ascunsă, înainte de afișare (fără pâlpâire), apoi la orice schimbare de mărime a cardului
  // (conținut încărcat, butonul „Urmărește” schimbat, șablonul temei) și a ferestrei. Stratul e `position: fixed`,
  // deci coordonatele sunt ale viewport-ului (ca `getBoundingClientRect()`), indiferent de scroll. Foaia de jos nu se
  // așază după nume (stă jos, pe toată lățimea).
  useLayoutEffect(() => {
    const el = layer.current;
    if (!open || !el || open.mode === "sheet") return;
    const update = () => {
      if (!open.anchor.isConnected) return;
      const rect = open.anchor.getBoundingClientRect();
      // Înălțimea întreagă a cardului: `scrollHeight` și când stratul e limitat (`maxHeight`) și derulează; cu săgeata
      // (care iese 5 px din strat) desenată, înălțimea stratului (săgeata nu face parte din card).
      const arrow = el.querySelector(":scope > .gcs-hoverCardLayer__arrow") !== null;
      const size = { width: el.offsetWidth, height: arrow ? el.offsetHeight : el.scrollHeight };
      const next = placeHoverCard(rect, size, { width: document.documentElement.clientWidth, height: window.innerHeight });
      // Săgeata: la mijlocul rândului numelui dinspre card (un nume rupt pe două rânduri are mai multe dreptunghiuri).
      const lines = open.anchor.getClientRects();
      const line = (next.side === "below" ? lines[lines.length - 1] : lines[0]) ?? rect;
      const x = hoverCardArrowX(line, next.left, size.width);
      setPlace((p) => (p && p.top === next.top && p.left === next.left && p.side === next.side && p.maxHeight === next.maxHeight && p.arrow === x ? p : { ...next, arrow: x }));
    };
    update();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(el);
    window.addEventListener("resize", update);
    // Derularea (inclusiv o schimbare mică de înălțime a paginii) mută cardul după nume, nu îl închide.
    window.addEventListener("scroll", update, { passive: true });
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update);
    };
  }, [open]);

  // Foaia de jos: focusul intră în ea, pagina de sub ea nu se derulează; la închidere, totul revine.
  const sheetKey = open?.mode === "sheet" ? open.key : null;
  useEffect(() => {
    if (!sheetKey) return;
    const root = document.documentElement;
    const overflow = root.style.overflow;
    root.style.overflow = "hidden";
    layer.current?.focus({ preventScroll: true });
    return () => {
      root.style.overflow = overflow;
    };
  }, [sheetKey]);

  useEffect(() => {
    const anchorOf = (e: Event) => hoverAnchorOf(e.target);
    const inCard = (e: Event) => e.target instanceof Element && e.target.closest(".gcs-hoverCardLayer") !== null;
    const touchedRecently = () => Date.now() - lastTouch.current < TOUCH_RECENT;
    const onOver = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      const a = anchorOf(e);
      if (a) show(a, OPEN_DELAY);
      else if (inCard(e)) keepOpen();
    };
    const onOut = (e: PointerEvent) => {
      if (e.pointerType === "touch" || current.current?.mode === "sheet") return;
      const a = anchorOf(e);
      if (a || inCard(e)) {
        // Doar deschiderea ancorei părăsite se anulează (ex. pagina derulată sub mouse nu anulează cardul cerut din tastatură).
        if (!a || a === pending.current) cancelOpen();
        scheduleClose();
      }
    };
    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === "touch") lastTouch.current = Date.now();
    };
    const onFocusIn = (e: FocusEvent) => {
      if (suppressFocus.current) {
        suppressFocus.current = false;
        return;
      }
      const a = anchorOf(e);
      if (a) show(a, OPEN_DELAY, "focus");
      else if (!inCard(e) && pendingSource.current === "focus" && current.current?.mode !== "sheet") {
        // Focusul a plecat de pe nume (Tab mai departe): cardul cerut din tastatură se închide. Unul deschis cu mouse-ul
        // rămâne (ex. chat-ul care își mută singur focusul în câmpul de scris).
        cancelOpen();
        scheduleClose();
      }
    };
    let pressTimer: ReturnType<typeof setTimeout> | undefined;
    const onTouchStart = (e: TouchEvent) => {
      lastTouch.current = Date.now();
      pressFired.current = false;
      const a = anchorOf(e);
      if (!a || inCard(e)) return;
      // Apăsarea lungă pe un nume: cardul (pe telefon, foaia de jos); atingerea scurtă merge la profil.
      pressTimer = setTimeout(() => {
        pressFired.current = true;
        show(a, 0, "touch");
      }, LONG_PRESS);
    };
    const onTouchEnd = (e: TouchEvent) => {
      clearTimeout(pressTimer);
      lastTouch.current = Date.now();
      if (e.type === "touchend" && pressFired.current) {
        pressFired.current = false;
        suppressClickUntil.current = Date.now() + 600;
      }
    };
    const onContextMenu = (e: MouseEvent) => {
      // Meniul linkului (apăsarea lungă pe Android) nu acoperă cardul abia deschis.
      if (pressFired.current || Date.now() < suppressClickUntil.current) e.preventDefault();
    };
    const onClick = (e: MouseEvent) => {
      if (Date.now() < suppressClickUntil.current) {
        // Clickul de la ridicarea degetului după apăsarea lungă: nu navighează, nu apasă nimic în foaie, nu o închide.
        suppressClickUntil.current = 0;
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      // Telefonul: atingerea unui avatar deschide cardul membrului (foaia de jos), fără să urmeze linkul din jurul lui.
      const avatar = touchedRecently() ? avatarAnchorOf(e.target) : null;
      if (avatar) {
        e.preventDefault();
        show(avatar, 0, "touch");
        return;
      }
      if (current.current && !inCard(e)) setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => {
      const now = current.current;
      if (e.key === "Escape" && now) {
        cancelOpen();
        setOpen(null);
        refocus(now.anchor);
        return;
      }
      if (e.key !== "Tab" || !now) return;
      const focusables = [...(document.querySelector(".gcs-hoverCardLayer")?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
      if (now.mode === "sheet") {
        // Foaia de jos e modală: Tab și Shift+Tab rămân în ea, de la ultimul element la primul și invers.
        e.preventDefault();
        if (focusables.length === 0) return;
        const i = focusables.indexOf(document.activeElement as HTMLElement);
        const next = e.shiftKey ? (i <= 0 ? focusables.length - 1 : i - 1) : i < 0 || i === focusables.length - 1 ? 0 : i + 1;
        focusables[next]!.focus();
        return;
      }
      // Tastatura: Tab de pe nume intră în card (primul buton / link); Tab după ultimul element (sau Shift+Tab de pe
      // primul) revine pe nume și închide cardul, ca ordinea paginii să continue de acolo.
      if (focusables.length === 0) return;
      const active = document.activeElement;
      if (active === now.anchor && !e.shiftKey) {
        e.preventDefault();
        keepOpen();
        focusables[0]!.focus();
      } else if ((active === focusables.at(-1) && !e.shiftKey) || (active === focusables[0] && e.shiftKey)) {
        e.preventDefault();
        cancelOpen();
        setOpen(null);
        refocus(now.anchor);
      }
    };
    // Cardul se închide doar când numele a ieșit din ecran (altfel stratul se mută odată cu el, vezi efectul de așezare).
    const onScroll = () => {
      const now = current.current;
      if (!now || now.mode === "sheet") return;
      const r = now.anchor.getBoundingClientRect();
      if (!now.anchor.isConnected || r.bottom < 0 || r.top > window.innerHeight) setOpen(null);
    };
    // `openMemberCard`: un click pe un avatar (ex. podiumul din chat) deschide cardul pe loc (o atingere: foaia de jos).
    const onRequest = (e: Event) => {
      const anchor = (e as CustomEvent<{ anchor?: unknown }>).detail?.anchor;
      if (anchor instanceof HTMLElement) show(anchor, 0, touchedRecently() ? "touch" : "pointer");
    };
    document.addEventListener(OPEN_CARD_EVENT, onRequest);
    document.addEventListener("pointerover", onOver);
    document.addEventListener("pointerout", onOut);
    document.addEventListener("pointerdown", onPointerDown, { passive: true });
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchend", onTouchEnd);
    document.addEventListener("touchcancel", onTouchEnd);
    document.addEventListener("touchmove", onTouchEnd, { passive: true });
    document.addEventListener("contextmenu", onContextMenu);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      document.removeEventListener(OPEN_CARD_EVENT, onRequest);
      document.removeEventListener("pointerover", onOver);
      document.removeEventListener("pointerout", onOut);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchend", onTouchEnd);
      document.removeEventListener("touchcancel", onTouchEnd);
      document.removeEventListener("touchmove", onTouchEnd);
      document.removeEventListener("contextmenu", onContextMenu);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll);
    };
  }, [show, scheduleClose, refocus]);

  if (!open) return null;
  const number = (n: number) => new Intl.NumberFormat(locale).format(n);
  const update = (next: CardData) => {
    if (open.kind !== "user") return;
    cache.set(open.userId, { at: Date.now(), data: next });
    setOpen((o) => (o?.kind === "user" && o.userId === open.userId ? { ...o, data: next } : o));
  };
  const content =
    open.kind === "group" ? (
      <GcsGroupCard data={open.data} labels={labels.group} format={{ number }} />
    ) : (
      <MemberCard userId={open.userId} anchor={open.anchor} data={open.data} labels={labels} locale={locale} onUpdate={update} onClose={() => setOpen(null)} />
    );
  const tone = toneOf(open);
  const label = open.kind === "user" ? open.data.user.name : undefined;

  if (open.mode === "sheet") {
    // Glisarea în jos: foaia urmează degetul (doar când conținutul ei e derulat sus); peste prag, se închide.
    const onTouchStart = (e: ReactTouchEvent<HTMLDivElement>) => {
      const el = layer.current;
      const y = e.touches[0]?.clientY;
      drag.current = el && el.scrollTop <= 0 && y !== undefined ? { y, dy: 0 } : null;
    };
    const onTouchMove = (e: ReactTouchEvent<HTMLDivElement>) => {
      const d = drag.current;
      const el = layer.current;
      const y = e.touches[0]?.clientY;
      if (!d || !el || y === undefined) return;
      d.dy = Math.max(0, y - d.y);
      el.toggleAttribute("data-dragging", d.dy > 0);
      el.style.transform = d.dy > 0 ? `translateY(${d.dy}px)` : "";
    };
    const onTouchEnd = () => {
      const d = drag.current;
      const el = layer.current;
      drag.current = null;
      if (!d || !el) return;
      el.removeAttribute("data-dragging");
      if (d.dy > SWIPE_CLOSE) setOpen(null);
      else el.style.transform = "";
    };
    return (
      <>
        <div className="gcs-hoverCardBackdrop" aria-hidden="true" data-testid="gcs-hover-backdrop" />
        <div
          ref={layer}
          className="gcs-hoverCardLayer gcs-hoverCardLayer--sheet"
          data-side="sheet"
          role="dialog"
          aria-modal="true"
          aria-label={label}
          tabIndex={-1}
          style={tone ? ({ "--gcs-hoverCard-tone": tone } as CSSProperties) : undefined}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          onTouchCancel={onTouchEnd}
          data-testid="gcs-hover-sheet"
        >
          <button type="button" className="gcs-hoverCardSheet__handle" aria-label={t("v3.close")} onClick={() => setOpen(null)} />
          {content}
        </div>
      </>
    );
  }

  // Săgeata spre nume: doar după așezare și când cardul încape întreg (un strat limitat derulează și ar tăia-o).
  const arrow = place !== null && place.maxHeight === null;
  return (
    <div
      ref={layer}
      className="gcs-hoverCardLayer"
      style={
        {
          top: place?.top ?? 0,
          left: place?.left ?? 0,
          ...(place?.maxHeight != null ? { maxHeight: place.maxHeight, overflowY: "auto" as const } : {}),
          ...(place ? { "--gcs-hoverCard-arrowX": `${place.arrow}px` } : {}),
          ...(tone ? { "--gcs-hoverCard-tone": tone } : {}),
        } as CSSProperties
      }
      data-side={place?.side ?? "pending"}
      onPointerEnter={keepOpen}
      onPointerLeave={(e) => {
        if (e.pointerType !== "touch") scheduleClose();
      }}
    >
      {content}
      {arrow && <span className="gcs-hoverCardLayer__arrow" aria-hidden="true" data-testid="gcs-hover-arrow" />}
    </div>
  );
}

/**
 * Cardul unui membru (hover card v3): datele, acțiunile Mesaj / Urmărește / Ignoră, „Găsește conținutul lui” și slotul
 * de extensie (`hoverCardActions`: ex. Mute / Kick / Avertisment din chat).
 */
function MemberCard({
  userId,
  anchor,
  data,
  labels,
  locale,
  onUpdate,
  onClose,
}: {
  userId: string;
  anchor: HTMLElement;
  data: CardData;
  labels: Labels;
  locale: string;
  onUpdate: (next: CardData) => void;
  onClose: () => void;
}) {
  const t = useTranslations("hoverCard");
  const format = useFormatter();
  const [pending, startTransition] = useTransition();
  const number = (n: number) => new Intl.NumberFormat(locale).format(n);
  const year = (iso: string) => String(new Date(iso).getFullYear());
  const relative = (iso: string) => format.relativeTime(new Date(iso));
  const date = (iso: string) => format.dateTime(new Date(iso), { day: "numeric", month: "long", year: "numeric" });

  const toggleFollow = () =>
    startTransition(async () => {
      const res = await followUser({ userId, follow: !data.viewer.isFollowing });
      if (!res.ok) return;
      let next: CardData = { ...data, stats: { ...data.stats, followers: res.data.followers }, viewer: { ...data.viewer, isFollowing: res.data.following } };
      // Cardul din șablon e randat pe server: îl cerem din nou, cu numărul nou de urmăritori.
      if (data.html) next = (await load(userId, true).catch(() => null)) ?? next;
      onUpdate(next);
    });
  const toggleIgnore = () =>
    startTransition(async () => {
      const ignore = !data.viewer.isIgnored;
      const res = await ignoreUser({ userId, posts: ignore, messages: ignore });
      if (res.ok) onUpdate({ ...data, viewer: { ...data.viewer, isIgnored: ignore } });
    });

  const v2: GcsHoverCardV2 | null =
    data.level && data.status && data.chips
      ? { level: data.level, status: data.status, chips: data.chips, profileHref: data.profileHref ?? `/members/${userId}-${data.user.slug}`, rankEmblem: data.rankEmblem ?? null }
      : null;
  const v2Labels: GcsHoverCardV2Labels = {
    onlineNow: t("v2.onlineNow"),
    playing: (server) => t("v2.playing", { server }),
    lastVisit: (time) => t("v2.lastVisit", { time }),
    level: (level, rank) => (rank ? t("v2.levelRank", { level, rank }) : t("v2.level", { level })),
    maxLevel: t("v2.maxLevel"),
    nextLevel: (name) => t("v2.nextLevel", { name }),
    elo: (elo, tier) => t("v2.elo", { elo, tier: t(`v2.tiers.${tier}`) }),
    vip: t("v2.vip"),
    badges: t("v2.badges"),
    allBadges: t("v3.allBadges"),
    registered: (when) => t("v3.registered", { date: when }),
    otherGroups: t("v3.otherGroups"),
    rank: t("v3.rank"),
    badgeEarned: (when) => t("v3.badgeEarned", { date: when }),
  };
  const ctx = { userId, name: data.user.name, anchor, isSelf: data.viewer.isSelf, close: onClose };
  const extensions = hoverCardActionProviders().map(({ key, Provider }) => <Provider key={key} ctx={ctx} />);
  const contentHref = v2 ? (data.contentHref ?? null) : null;
  // Primul rând: Mesaj (eticheta întreagă, ia restul rândului), apoi Urmărește și Ignoră ca iconițe cu tooltip. Sub el,
  // „Găsește conținutul lui” pe toată lățimea; apoi extensiile (moderarea din chat), fiecare pe rândul ei.
  const primary = data.viewer.canMessage ? (
    <GcsButton variant="primary" size="sm" asChild className="gcs-hoverCard__primary" icon={<GcsIconSvg icon={faEnvelope} />}>
      <Link href={`/messages/new?to=${encodeURIComponent(userId)}`} data-testid="gcs-hover-message">
        <span className="gcs-hoverCard__label">{labels.message}</span>
      </Link>
    </GcsButton>
  ) : null;
  const followLabel = data.viewer.isFollowing ? labels.unfollow : labels.follow;
  const ignoreLabel = data.viewer.isIgnored ? t("v2.unignore") : t("v2.ignore");
  const tools = [
    data.viewer.canFollow && (
      <GcsHoverCardIconAction
        key="follow"
        label={followLabel}
        icon={<GcsIconSvg icon={data.viewer.isFollowing ? faUserMinus : faUserPlus} />}
        onClick={toggleFollow}
        disabled={pending}
        aria-pressed={data.viewer.isFollowing}
        data-testid="gcs-hover-follow"
      />
    ),
    v2 && data.viewer.canIgnore && (
      <GcsHoverCardIconAction
        key="ignore"
        label={ignoreLabel}
        icon={<GcsIconSvg icon={faBan} />}
        onClick={toggleIgnore}
        disabled={pending}
        aria-pressed={data.viewer.isIgnored === true}
        data-testid="gcs-hover-ignore"
      />
    ),
  ];
  const wide = contentHref ? (
    <GcsButton variant="ghost" size="sm" asChild className="gcs-hoverCard__wide" icon={<GcsIconSvg icon={faFileLines} />}>
      <Link href={contentHref} data-testid="gcs-hover-content">
        <span className="gcs-hoverCard__label">{t("v3.findContent")}</span>
      </Link>
    </GcsButton>
  ) : null;
  const actions = <GcsHoverCardActions primary={primary} tools={tools} wide={wide} extra={extensions} />;
  const hasActions = data.viewer.canFollow || data.viewer.canMessage || contentHref !== null || hoverCardActionProviders().length > 0;
  return data.html ? (
    <TemplatedCard html={data.html} actions={hasActions ? actions : null} />
  ) : (
    <GcsHoverCard data={{ ...data, v2 }} labels={labels} v2Labels={v2Labels} format={{ number, year, relative, date }} {...(hasActions ? { actions } : {})} />
  );
}
