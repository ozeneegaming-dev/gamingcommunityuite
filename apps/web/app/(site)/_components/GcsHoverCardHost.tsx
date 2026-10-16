"use client";

import { faBan, faEnvelope, faFileLines, faUserMinus, faUserPlus } from "@fortawesome/free-solid-svg-icons";
import {
  GcsButton,
  GcsGroupCard,
  GcsHoverCard,
  GcsIconSvg,
  GcsTooltip,
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
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { hoverAnchorKey, hoverAnchorOf, OPEN_CARD_EVENT } from "@/lib/hover-anchor";
import { hoverCardActionProviders } from "@/lib/hover-card-actions";
import { followUser, ignoreUser } from "../profile-actions";

/**
 * `html`: markup-ul din șablonul `members.hover_card` al temei (deja sanitizat pe server), dacă tema l-a modificat.
 * Câmpurile v2 (nivelul, statusul, cipurile, „Conținutul lui”, Ignoră) vin din `GcsHoverCardLoader`.
 */
type CardData = GcsHoverCardData &
  Partial<Pick<GcsHoverCardV2, "level" | "status" | "chips" | "profileHref">> & {
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

type Open =
  | { kind: "user"; key: string; userId: string; anchor: HTMLElement; data: CardData }
  | { kind: "group"; key: string; groupId: string; anchor: HTMLElement; data: GcsGroupCardData };

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
 * apare după 300 ms de hover sau focus, rămâne deschis cât timp mouse-ul e pe el, se închide cu Escape. Pe ecrane
 * tactile: apăsare lungă.
 */
export function GcsHoverCardHost({ labels, locale }: { labels: Labels; locale: string }) {
  const [open, setOpen] = useState<Open | null>(null);
  /** Locul cardului, calculat după mărimea lui măsurată; `null` = încă nemăsurat (stratul e ascuns). */
  const [place, setPlace] = useState<GcsHoverCardPlacement | null>(null);
  const layer = useRef<HTMLDivElement>(null);
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
    const key = hoverAnchorKey(anchor);
    if (!key) return;
    clearTimeout(openTimer.current);
    keepOpen();
    if (current.current?.key === key) return;
    openTimer.current = setTimeout(async () => {
      const id = key.slice(2);
      if (key.startsWith("g:")) {
        const data = await loadGroup(id).catch(() => null);
        if (!data || !anchor.isConnected) return;
        setPlace(null);
        setOpen({ kind: "group", key, groupId: id, anchor, data });
        return;
      }
      const data = await load(id).catch(() => null);
      if (!data || !anchor.isConnected) return;
      setPlace(null);
      setOpen({ kind: "user", key, userId: id, anchor, data });
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
      // `scrollHeight`: înălțimea întreagă a cardului, și când stratul e limitat (`maxHeight`) și derulează.
      const next = placeHoverCard(open.anchor.getBoundingClientRect(), { width: el.offsetWidth, height: el.scrollHeight }, { width: document.documentElement.clientWidth, height: window.innerHeight });
      setPlace((p) => (p && p.top === next.top && p.left === next.left && p.side === next.side && p.maxHeight === next.maxHeight ? p : next));
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
    const anchorOf = (e: Event) => hoverAnchorOf(e.target);
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
      const now = current.current;
      if (e.key === "Escape" && now) {
        const anchor = now.anchor;
        cancelOpen();
        setOpen(null);
        suppressFocus.current = true;
        anchor.focus();
        return;
      }
      // Tastatura: Tab de pe nume intră în card (primul buton / link); Tab după ultimul element (sau Shift+Tab de pe
      // primul) revine pe nume și închide cardul, ca ordinea paginii să continue de acolo.
      if (e.key !== "Tab" || !now) return;
      const focusables = [...(document.querySelector(".gcs-hoverCardLayer")?.querySelectorAll<HTMLElement>("a[href], button:not(:disabled), [tabindex]:not([tabindex='-1'])") ?? [])];
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
        suppressFocus.current = true;
        now.anchor.focus();
      }
    };
    const onScroll = () => setOpen(null);
    // `openMemberCard`: un click pe un avatar (ex. podiumul din chat) deschide cardul pe loc.
    const onRequest = (e: Event) => {
      const anchor = (e as CustomEvent<{ anchor?: unknown }>).detail?.anchor;
      if (anchor instanceof HTMLElement) show(anchor, 0);
    };
    document.addEventListener(OPEN_CARD_EVENT, onRequest);
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
      document.removeEventListener(OPEN_CARD_EVENT, onRequest);
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
  const number = (n: number) => new Intl.NumberFormat(locale).format(n);
  const layerProps = {
    ref: layer,
    className: "gcs-hoverCardLayer",
    style: { top: place?.top ?? 0, left: place?.left ?? 0, ...(place?.maxHeight != null ? { maxHeight: place.maxHeight, overflowY: "auto" as const } : {}) },
    "data-side": place?.side ?? "pending",
    onPointerEnter: keepOpen,
    onPointerLeave: scheduleClose,
  };
  if (open.kind === "group") {
    return (
      <div {...layerProps}>
        <GcsGroupCard data={open.data} labels={labels.group} format={{ number }} />
      </div>
    );
  }
  const update = (next: CardData) => {
    cache.set(open.userId, { at: Date.now(), data: next });
    setOpen((o) => (o?.kind === "user" && o.userId === open.userId ? { ...o, data: next } : o));
  };
  return (
    <div {...layerProps}>
      <MemberCard userId={open.userId} anchor={open.anchor} data={open.data} labels={labels} locale={locale} onUpdate={update} onClose={() => setOpen(null)} />
    </div>
  );
}

/**
 * Cardul unui membru (hover card v2): datele, acțiunile Mesaj / Urmărește / Conținutul lui / Ignoră și slotul de extensie
 * (`hoverCardActions`: ex. Mute / Kick / Avertisment din chat).
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

  const v2: GcsHoverCardV2 | null = data.level && data.status && data.chips ? { level: data.level, status: data.status, chips: data.chips, profileHref: data.profileHref ?? `/members/${userId}-${data.user.slug}` } : null;
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
    allBadges: t("v2.allBadges"),
  };
  const ctx = { userId, name: data.user.name, anchor, isSelf: data.viewer.isSelf, close: onClose };
  const extensions = hoverCardActionProviders().map(({ key, Provider }) => <Provider key={key} ctx={ctx} />);
  const contentHref = data.contentHref ?? null;
  const actions = (
    <>
      {data.viewer.canMessage && (
        <GcsButton variant="primary" size="sm" asChild icon={<GcsIconSvg icon={faEnvelope} />}>
          <Link href={`/messages/new?to=${encodeURIComponent(userId)}`} data-testid="gcs-hover-message">
            {labels.message}
          </Link>
        </GcsButton>
      )}
      {data.viewer.canFollow && (
        <GcsButton
          variant="ghost"
          size="sm"
          icon={<GcsIconSvg icon={data.viewer.isFollowing ? faUserMinus : faUserPlus} />}
          onClick={toggleFollow}
          disabled={pending}
          aria-pressed={data.viewer.isFollowing}
          data-testid="gcs-hover-follow"
        >
          {data.viewer.isFollowing ? labels.unfollow : labels.follow}
        </GcsButton>
      )}
      {v2 && contentHref && (
        <GcsButton variant="ghost" size="sm" asChild icon={<GcsIconSvg icon={faFileLines} />}>
          <Link href={contentHref} data-testid="gcs-hover-content">
            {t("v2.content")}
          </Link>
        </GcsButton>
      )}
      {v2 && data.viewer.canIgnore && (
        <GcsTooltip content={data.viewer.isIgnored ? t("v2.unignore") : t("v2.ignore")}>
          <button
            type="button"
            className="gcs-btn gcs-btn--ghost gcs-btn--sm gcs-hoverCard__iconBtn"
            onClick={toggleIgnore}
            disabled={pending}
            aria-pressed={data.viewer.isIgnored === true}
            aria-label={data.viewer.isIgnored ? t("v2.unignore") : t("v2.ignore")}
            data-testid="gcs-hover-ignore"
          >
            <GcsIconSvg icon={faBan} />
          </button>
        </GcsTooltip>
      )}
      {extensions}
    </>
  );
  const hasActions = data.viewer.canFollow || data.viewer.canMessage || (v2 !== null && contentHref !== null) || hoverCardActionProviders().length > 0;
  return data.html ? (
    <TemplatedCard html={data.html} actions={hasActions ? actions : null} />
  ) : (
    <GcsHoverCard data={{ ...data, v2 }} labels={labels} v2Labels={v2Labels} format={{ number, year, relative }} {...(hasActions ? { actions } : {})} />
  );
}
