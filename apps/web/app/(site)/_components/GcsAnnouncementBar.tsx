"use client";

import { faXmark } from "@fortawesome/free-solid-svg-icons";
import {
  ANNOUNCEMENT_MOBILE_MAX,
  announcementCountdownOver,
  announcementDay,
  announcementOnPage,
  announcementPlainText,
  announcementScheduleOk,
  parseAnnouncementText,
  type GcsAnnouncementBar as Bar,
  type GcsAnnouncementConfig,
  type GcsAnnouncementEvent,
  type GcsAnnouncementNode,
  type GcsAnnouncementPosition,
  type GcsAnnouncementVars,
} from "@gcs/modules/announcement";
import { GcsIconSvg } from "@gcs/ui";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode, type RefObject } from "react";

export type GcsAnnouncementLabels = { region: string; dismiss: string; show: string; days: string; timeLeft: string };
/** Desenul unei iconițe (calculat pe server, ca browserul să nu primească tot pachetul). */
export type GcsAnnouncementIcon = { width: number; height: number; path: string | string[] };
type Settings = Pick<GcsAnnouncementConfig, "rotateSeconds" | "multiple" | "transition" | "order" | "pauseOnHover" | "dots" | "stats">;

const COOKIE = "gcs-ann";
/** Intrările păstrate în cookie (cele mai noi); o bară închisă de mult și schimbată nu mai contează. */
const MAX_ENTRIES = 30;
/** Afișările numărate azi (`{ <bară>~<versiune>: <zi> }`): fiecare bară se numără o dată pe zi în acest browser. */
const SEEN_KEY = "gcs-ann-seen";

/** Ține minte închiderea (cookie-ul citit și de server), cu ziua, pentru reapariția după N zile. */
function remember(viewerKey: string, bar: Bar) {
  const current = document.cookie
    .split("; ")
    .find((c) => c.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);
  let raw = "";
  try {
    raw = decodeURIComponent(current ?? "");
  } catch {
    // Valoare stricată: o luăm de la capăt.
  }
  const entries = raw
    .split("|")
    .filter(Boolean)
    .filter((e) => !e.startsWith(`${viewerKey}~${bar.id}~`));
  entries.push(`${viewerKey}~${bar.id}~${bar.version}~${announcementDay()}`);
  const value = encodeURIComponent(entries.slice(-MAX_ENTRIES).join("|"));
  document.cookie = `${COOKIE}=${value}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
}

/** Un eveniment pentru statistici (fără să aștepte răspunsul; pleacă și când pagina se schimbă). */
function track(bar: Bar, event: GcsAnnouncementEvent) {
  try {
    void fetch("/api/announcement/event", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bar: bar.id, event }), keepalive: true }).catch(() => {});
  } catch {
    // Statisticile nu strică bara.
  }
}

/** Afișarea se trimite o dată pe zi per bară (și serverul o numără o singură dată pe zi). */
function trackView(bar: Bar) {
  const day = new Date().toISOString().slice(0, 10);
  const key = `${bar.id}~${bar.version}`;
  let seen: Record<string, string> = {};
  try {
    seen = JSON.parse(localStorage.getItem(SEEN_KEY) ?? "{}") as Record<string, string>;
    if (seen[key] === day) return;
    seen = Object.fromEntries(Object.entries(seen).filter(([, d]) => d === day));
    seen[key] = day;
    localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
  } catch {
    // Fără stocare locală: serverul tot numără o singură dată pe zi.
  }
  track(bar, "view");
}

const isInternal = (href: string) => href.startsWith("/") && !href.startsWith("//");

function BarLink({ href, newTab, className, onClick, children, testId }: { href: string; newTab: boolean; className: string; onClick?: () => void; children: ReactNode; testId?: string }) {
  if (isInternal(href) && !newTab) {
    return (
      <Link href={href} className={className} onClick={onClick} data-testid={testId}>
        {children}
      </Link>
    );
  }
  return (
    <a href={href} className={className} onClick={onClick} rel={isInternal(href) ? undefined : "noopener nofollow"} target={newTab ? "_blank" : undefined} data-testid={testId}>
      {children}
    </a>
  );
}

/** Textul formatat al barei (din nodurile analizate, fără HTML): gros, cursiv, linkuri, variabile. */
export function GcsAnnouncementText({ nodes, vars }: { nodes: GcsAnnouncementNode[]; vars: GcsAnnouncementVars }): ReactNode {
  return nodes.map((n, i) => {
    if (n.t === "text") return n.v;
    if (n.t === "var") return vars[n.name] ?? "";
    if (n.t === "b") return <strong key={i}>{<GcsAnnouncementText nodes={n.c} vars={vars} />}</strong>;
    if (n.t === "i") return <em key={i}>{<GcsAnnouncementText nodes={n.c} vars={vars} />}</em>;
    if (n.t !== "a") return null;
    return (
      <BarLink key={i} href={n.href} newTab={!isInternal(n.href)} className="gcs-annBar__inlineLink">
        <GcsAnnouncementText nodes={n.c} vars={vars} />
      </BarLink>
    );
  });
}

/** Fundalul și culoarea textului la presetul „personalizat” (celelalte presete vin din CSS, pe tokenurile temei). */
export function announcementBarStyle(bar: Bar): CSSProperties | undefined {
  if (bar.preset !== "custom") return undefined;
  const bg =
    bar.bgKind === "color"
      ? bar.bgColor
      : bar.bgKind === "gradient"
        ? `linear-gradient(${bar.bgAngle}deg, ${bar.bgColor}, ${bar.bgColor2})`
        : bar.bgImage
          ? // Stratul închis peste imagine: textul rămâne citeț pe orice fotografie.
            `linear-gradient(rgb(0 0 0 / 0.55), rgb(0 0 0 / 0.55)), url("${bar.bgImage}") center / cover no-repeat, ${bar.bgColor}`
          : bar.bgColor;
  return { "--gcs-ann-bg": bg, "--gcs-ann-fg": bar.fgColor } as CSSProperties;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Timpul rămas: `2z 04:12:33` (zilele doar când mai sunt). */
function countdownText(ms: number, daysLabel: string): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86_400);
  const hms = `${pad(Math.floor((s % 86_400) / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
  return d > 0 ? `${daysLabel.replace("{d}", String(d))} ${hms}` : hms;
}

export function GcsAnnouncementIconSvg({ icon }: { icon: GcsAnnouncementIcon }) {
  const paths = Array.isArray(icon.path) ? icon.path : [icon.path];
  return (
    <svg className="gcs-annBar__svg" viewBox={`0 0 ${icon.width} ${icon.height}`} width="1em" height="1em" fill="currentColor" aria-hidden="true" focusable="false">
      {paths.map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}

export type GcsAnnouncementBarViewProps = {
  bar: Bar;
  vars: GcsAnnouncementVars;
  icon: GcsAnnouncementIcon | null;
  labels: GcsAnnouncementLabels;
  now: Date;
  /** Animația de intrare a barei (rotația). */
  transition?: Settings["transition"];
  /** Punctele de alegere și butonul de închidere (în dreapta). */
  tools?: ReactNode;
  onCta?: () => void;
  onDismiss?: () => void;
  /** În previzualizarea din ACP: aspectul de telefon / desktop forțat (fără media queries). */
  device?: "desktop" | "mobile";
  testId?: string;
  slideKey?: string;
};

/**
 * O bară de anunț (aspectul ei, același pe site și în previzualizarea din ACP): iconița, pastila, textul (fix sau care
 * derulează; varianta scurtă pe telefon), numărătoarea, linkul secundar, butonul și închiderea.
 */
export function GcsAnnouncementBarView({ bar, vars, icon, labels, now, transition = "fade", tools, onCta, onDismiss, device, testId = "gcs-ann-bar", slideKey }: GcsAnnouncementBarViewProps) {
  const text = useMemo(() => parseAnnouncementText(bar.text), [bar.text]);
  const short = useMemo(() => (bar.mobileText ? parseAnnouncementText(bar.mobileText) : null), [bar.mobileText]);
  const over = announcementCountdownOver(bar, now);
  const marquee = bar.textMode === "marquee";
  const body = (
    <>
      <span className={short ? "gcs-annBar__full" : undefined}>
        <GcsAnnouncementText nodes={text} vars={vars} />
      </span>
      {short && (
        <span className="gcs-annBar__short">
          <GcsAnnouncementText nodes={short} vars={vars} />
        </span>
      )}
    </>
  );
  // Derularea: durata după lungimea textului (cam aceeași viteză pentru orice text).
  const speed = `${Math.max(10, Math.round(announcementPlainText(text, vars).length * 0.2))}s`;
  const cls = [
    "gcs-annBar",
    `gcs-annBar--${bar.preset}`,
    `gcs-annBar--${bar.size}`,
    `gcs-annBar--${bar.position}`,
    bar.fullWidth && bar.position !== "page" ? "gcs-annBar--full" : "gcs-annBar--boxed",
    bar.align === "center" && "gcs-annBar--center",
    marquee && "gcs-annBar--marquee",
    bar.devices !== "all" && `gcs-annBar--only-${bar.devices}`,
    device && `gcs-annBar--device-${device}`,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <section className={cls} style={announcementBarStyle(bar)} aria-label={labels.region} data-testid={testId} data-bar={bar.id} data-position={bar.position}>
      <div className="gcs-annBar__inner">
        <div key={slideKey ?? bar.id} className={`gcs-annBar__slide gcs-annBar__slide--${transition}`}>
          {icon && (
            <span className="gcs-annBar__icon">
              <GcsAnnouncementIconSvg icon={icon} />
            </span>
          )}
          {bar.label && <span className={`gcs-annBar__label gcs-annBar__label--${bar.pillStyle}`}>{bar.label}</span>}
          <span className="gcs-annBar__text" data-testid="gcs-ann-bar-text">
            {marquee ? (
              <span className="gcs-annBar__marquee">
                <span className="gcs-annBar__track" style={{ "--gcs-ann-speed": speed } as CSSProperties}>
                  {body}
                </span>
              </span>
            ) : (
              body
            )}
          </span>
          {bar.countdown && (over ? bar.countdown.onEnd === "text" && bar.countdown.endText : true) && (
            <span className="gcs-annBar__count" role="timer" aria-label={labels.timeLeft} data-testid="gcs-ann-countdown">
              {over ? bar.countdown.endText : countdownText(Date.parse(bar.countdown.at) - now.getTime(), labels.days)}
            </span>
          )}
          {bar.link && (
            <BarLink href={bar.link.href} newTab={!isInternal(bar.link.href)} className="gcs-annBar__link">
              {bar.link.label}
            </BarLink>
          )}
          {bar.cta && (
            <BarLink href={bar.cta.href} newTab={bar.cta.newTab} className={`gcs-annBar__cta gcs-annBar__cta--${bar.cta.style}`} onClick={onCta} testId="gcs-ann-cta">
              {bar.cta.label} <span className="gcs-annBar__arrow" aria-hidden="true">→</span>
            </BarLink>
          )}
        </div>
        {(tools || (bar.dismissible && onDismiss)) && (
          <div className="gcs-annBar__tools">
            {tools}
            {bar.dismissible && onDismiss && (
              <button type="button" className="gcs-annBar__close" aria-label={labels.dismiss} onClick={onDismiss} data-testid="gcs-ann-dismiss">
                <GcsIconSvg icon={faXmark} />
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

const MOBILE_QUERY = `(max-width: ${ANNOUNCEMENT_MOBILE_MAX}px)`;
const subscribeMobile = (cb: () => void) => {
  const mq = window.matchMedia(MOBILE_QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};

/** Ecranul e „de telefon” (`null` pe server: atunci decid regulile CSS). */
function useIsMobile(): boolean | null {
  return useSyncExternalStore(
    subscribeMobile,
    () => window.matchMedia(MOBILE_QUERY).matches,
    () => null,
  );
}

/** Ora de acum: cea a serverului la prima randare (aceeași în HTML și la hidratare), apoi a browserului. */
function useNow(serverNow: string, fast: boolean): Date {
  const [now, setNow] = useState(() => new Date(serverNow));
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), fast ? 1000 : 30_000);
    return () => clearInterval(id);
  }, [fast]);
  return now;
}

/** Bara lipită sus: antetul lipit coboară cu înălțimea ei; sub antet, bara se lipește sub antetul vizibil. */
function useStickyOffsets(slot: RefObject<HTMLDivElement | null>, position: GcsAnnouncementPosition, sticky: boolean) {
  useEffect(() => {
    const el = slot.current;
    if (!el || !sticky) return;
    const root = document.documentElement;
    if (position === "top") {
      const ro = new ResizeObserver(() => root.style.setProperty("--gcs-ann-top-h", `${el.offsetHeight}px`));
      ro.observe(el);
      return () => {
        ro.disconnect();
        root.style.removeProperty("--gcs-ann-top-h");
      };
    }
    if (position !== "under") return;
    let frame = 0;
    let late: ReturnType<typeof setTimeout> | undefined;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const header = document.querySelector<HTMLElement>(".gcs-hb[data-sticky], .gcs-siteHeader");
        el.style.top = `${Math.max(0, Math.round(header?.getBoundingClientRect().bottom ?? 0))}px`;
      });
    };
    const onScroll = () => {
      update();
      // Antetul care se ascunde la derulare alunecă puțin după ultimul eveniment.
      clearTimeout(late);
      late = setTimeout(update, 360);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(late);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", update);
      el.style.top = "";
    };
  }, [slot, position, sticky]);
}

export type GcsAnnouncementBarProps = {
  position: GcsAnnouncementPosition;
  bars: Bar[];
  settings: Settings;
  viewerKey: string;
  timeZone: string;
  vars: GcsAnnouncementVars;
  icons: Record<string, GcsAnnouncementIcon>;
  labels: GcsAnnouncementLabels;
  /** Ora serverului la randare (ISO). */
  now: string;
};

/**
 * Locul unei poziții a barei de anunț (sus, sub antet, în pagină, jos): barele ei, filtrate în browser la fiecare
 * navigare (paginile, zilele și orele în fusul site-ului, dispozitivul, finalul numărătorii) și fără cele închise acum.
 * Mai multe bare se rotesc (pauză la hover / focus, punctele de alegere, ordinea din listă sau la întâmplare) sau stau
 * una sub alta. Închiderea rămâne ținută minte (cookie, până la o versiune nouă sau N zile); afișările, click-urile și
 * închiderile se numără, dacă statisticile sunt pornite.
 */
export function GcsAnnouncementBar({ position, bars: initial, settings, viewerKey, timeZone, vars, icons, labels, now: serverNow }: GcsAnnouncementBarProps) {
  const pathname = usePathname();
  const mobile = useIsMobile();
  const slot = useRef<HTMLDivElement>(null);
  const [closed, setClosed] = useState<string[]>([]);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [order, setOrder] = useState<string[] | null>(null);
  const now = useNow(serverNow, initial.some((b) => b.countdown));

  // Ordinea la întâmplare se alege după hidratare (HTML-ul serverului rămâne cel din listă).
  useEffect(() => {
    if (settings.order !== "random") return;
    const ids = initial.map((b) => b.id);
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    }
    setOrder(ids);
  }, [initial, settings.order]);

  const sorted = order ? [...initial].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id)) : initial;
  const bars = sorted.filter(
    (b) =>
      !closed.includes(b.id) &&
      announcementOnPage(b, pathname) &&
      announcementScheduleOk(b, now, timeZone) &&
      (mobile === null || b.devices === "all" || (b.devices === "mobile") === mobile),
  );
  const count = bars.length;
  const stack = settings.multiple === "stack";
  const at = Math.min(index, Math.max(0, count - 1));
  const current = bars[at];
  const sticky = bars.some((b) => b.sticky);
  useStickyOffsets(slot, position, sticky);

  // Rotația: fiecare bară stă cât îi e setat (sau cât spun setările generale).
  const seconds = current?.rotateSeconds ?? settings.rotateSeconds;
  useEffect(() => {
    if (stack || count < 2 || paused) return;
    const id = setTimeout(() => setIndex((i) => (i + 1) % count), seconds * 1000);
    return () => clearTimeout(id);
  }, [stack, count, paused, seconds, at]);

  // Statisticile: afișarea barelor arătate acum (o dată pe zi per bară).
  const shownIds = (stack ? bars : current ? [current] : []).map((b) => `${b.id}~${b.version}`).join("|");
  useEffect(() => {
    if (!settings.stats || mobile === null || !shownIds) return;
    for (const b of stack ? bars : current ? [current] : []) trackView(b);
    // `shownIds` rezumă barele arătate (lista se recalculează la fiecare randare).
  }, [shownIds, settings.stats, mobile === null]);

  if (count === 0) return null;

  const close = (bar: Bar, event: GcsAnnouncementEvent | null) => {
    remember(viewerKey, bar);
    if (event && settings.stats) track(bar, event);
    setClosed((list) => [...list, bar.id]);
    setIndex(0);
  };
  const ctaClick = (bar: Bar) => {
    if (settings.stats) track(bar, "click");
    if (bar.closeOnCta) close(bar, null);
  };
  const hover = settings.pauseOnHover
    ? { onMouseEnter: () => setPaused(true), onMouseLeave: () => setPaused(false), onFocus: () => setPaused(true), onBlur: () => setPaused(false) }
    : {};
  const view = (bar: Bar, tools?: ReactNode) => (
    <GcsAnnouncementBarView
      key={stack ? bar.id : undefined}
      bar={bar}
      vars={vars}
      icon={bar.icon ? (icons[bar.icon] ?? null) : null}
      labels={labels}
      now={now}
      transition={stack ? "none" : settings.transition}
      tools={tools}
      onCta={() => ctaClick(bar)}
      onDismiss={() => close(bar, "dismiss")}
    />
  );

  return (
    <div
      ref={slot}
      className={`gcs-annSlot gcs-annSlot--${position}`}
      data-sticky={sticky ? "" : undefined}
      aria-roledescription={!stack && count > 1 ? "carousel" : undefined}
      aria-live={!stack && count > 1 && !paused ? "off" : "polite"}
      data-testid={`gcs-ann-slot-${position}`}
      {...hover}
    >
      {stack
        ? bars.map((b) => view(b))
        : current &&
          view(
            current,
            settings.dots && count > 1
              ? bars.map((b, i) => (
                  <button
                    key={b.id}
                    type="button"
                    className="gcs-annBar__dot"
                    aria-label={labels.show.replace("{n}", String(i + 1))}
                    aria-current={i === at ? "true" : undefined}
                    onClick={() => setIndex(i)}
                    data-testid="gcs-ann-dot"
                  />
                ))
              : undefined,
          )}
    </div>
  );
}
