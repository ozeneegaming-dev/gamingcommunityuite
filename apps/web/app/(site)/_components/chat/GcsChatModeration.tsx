"use client";

import { faCopy, faEye, faEyeSlash, faFlag, faTrashCan } from "@fortawesome/free-regular-svg-icons";
import {
  faBan,
  faChevronRight,
  faClockRotateLeft,
  faCommentSlash,
  faFaceSmile,
  faGaugeSimple,
  faGavel,
  faLink,
  faPen,
  faReply,
  faRightFromBracket,
  faShieldHalved,
  faThumbtack,
  faTrashArrowUp,
  faTriangleExclamation,
  faUser,
  faUserSlash,
} from "@fortawesome/free-solid-svg-icons";
import type { GcsErrorPayload, GcsResult } from "@gcs/core";
import type { GcsChatEphemeral, GcsChatGrantView, GcsChatMessageView, GcsChatModCard, GcsChatModMenu, GcsChatRight, GcsChatSystemLine, GcsChatViewerState } from "@gcs/modules";
import { GcsButton, GcsIconSvg, GcsMemberName, GcsModal, gcsToast, type GcsIconSvgProps } from "@gcs/ui";
import { useFormatter, useTranslations } from "next-intl";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { memberHref } from "@/lib/forum-urls";
import { registerHoverCardActions, type GcsHoverCardActionContext } from "@/lib/hover-card-actions";
import { useErrorMessage } from "@/lib/use-error-message";
import {
  banChatUser,
  hideChatMessage,
  kickChatUser,
  liftChatSanction,
  loadChatModCard,
  loadChatModState,
  muteChatUser,
  purgeChatUser,
  reportChat,
  slowChatUser,
  warnChatUser,
} from "../../chat-actions";
import { useRealtime } from "../realtime/GcsRealtimeProvider";
import type { GcsComposerCommand } from "./GcsChatComposer";

/** Meniul de moderare al camerei, cu „Istoricul lui în chat” (doar cu Chat Pro și dreptul de istoric). */
export type GcsChatRoomMod = GcsChatModMenu & { history: boolean; rooms?: string[] };

/** Evenimentul cu care cardul membrului (acțiunile rapide din chat) cere camerei un dialog de moderare. */
export const CHAT_MOD_EVENT = "gcs:chat-mod";
export type GcsChatModRequest = { action: "mute" | "kick" | "warn"; userId: string; name: string; channel: string };

type Target = { userId: string; name: string; messageId: number | null; body?: string };
export type GcsChatModKind = "warn" | "mute" | "kick" | "ban" | "slow" | "purge";

/** Duratele din submeniuri și dialoguri (minute; `null` = permanent). */
const DURATIONS: Record<"mute" | "kick" | "ban", (number | null)[]> = {
  mute: [5, 15, 60, 1440, null],
  kick: [5, 15, 60, 1440],
  ban: [60, 1440, 7 * 1440, 30 * 1440, null],
};
const SLOW_SECONDS = [10, 30, 60, 120];
const SLOW_MINUTES: (number | null)[] = [15, 60, 1440, null];
const PURGE_WINDOWS = ["1h", "24h", "all"] as const;

/** O durată în minute, în cuvinte („15 minute”, „1 oră”, „permanent”). */
export function useDuration(): (minutes: number | null) => string {
  const t = useTranslations("chat.mod.dur");
  return useCallback(
    (minutes: number | null) => {
      if (minutes === null || minutes <= 0) return t("forever");
      if (minutes % 1440 === 0) return t("days", { count: minutes / 1440 });
      if (minutes % 60 === 0) return t("hours", { count: minutes / 60 });
      return t("minutes", { count: minutes });
    },
    [t],
  );
}

/** Secundele rămase până la `until` (actualizat în fiecare secundă), sau `null` fără termen. */
function useRemaining(until: string | null): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!until) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [until]);
  return until ? Math.max(0, Math.ceil((Date.parse(until) - now) / 1000)) : null;
}

const clock = (s: number) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
};

// ─── Starea de moderare a camerei ────────────────────────────────────────────────────────────────

/**
 * Moderarea unei camere, în client: meniul (drepturile viewer-ului, reîncărcat live la un acces dat sau retras), starea
 * viewer-ului (mute cu numărătoare, kick / ban, slow mode personal, actualizate live din `user:<id>`), dialogurile
 * acțiunilor și fișa de moderare, plus cererile venite din cardul membrului (acțiunile rapide).
 */
export function useChatModeration(opts: { channel: string; viewerId: string | null; mod: GcsChatRoomMod; state: GcsChatViewerState; onDone?: (kind: GcsChatModKind) => void }) {
  const { channel, viewerId } = opts;
  const realtime = useRealtime();
  const [mod, setMod] = useState(opts.mod);
  const [state, setState] = useState(opts.state);
  const [dialog, setDialog] = useState<{ kind: GcsChatModKind; target: Target; preset?: number | string | null } | null>(null);
  const [card, setCard] = useState<Target | null>(null);
  const onDone = useRef(opts.onDone);
  onDone.current = opts.onDone;

  const reload = useCallback(() => {
    void loadChatModState({ channel }).then((r) => {
      if (!r.ok) return;
      setMod((m) => ({ ...r.data.menu, history: m.history }));
      setState(r.data.state);
    });
  }, [channel]);

  useEffect(() => {
    const offs = [
      // Doar evenimentele camerei `user:<id>` a viewer-ului ajung aici (serverul le trimite numai lui).
      realtime.on("chat:sanction", (data) => {
        const d = data as { kind?: string; channel?: string | null; until?: string | null; reason?: string; seconds?: number; active?: boolean } | null;
        if (!d?.kind || (d.channel !== null && d.channel !== undefined && d.channel !== channel && d.kind !== "ban")) return;
        if (d.kind === "mute") setState((s) => ({ ...s, mute: d.active ? { reason: d.reason ?? "", until: d.until ?? null } : null }));
        else if (d.kind === "kick" || d.kind === "ban") setState((s) => ({ ...s, block: d.active ? { kind: d.kind as "kick" | "ban", channel: d.channel ?? null, until: d.until ?? null, reason: d.reason ?? "" } : null }));
        else if (d.kind === "slow") setState((s) => ({ ...s, slowSeconds: d.active ? (d.seconds ?? 0) : 0 }));
      }),
      realtime.on("chat:rights", () => reload()),
    ];
    // Acțiunile rapide din cardul membrului (doar pentru camera aceasta).
    const onRequest = (e: Event) => {
      const r = (e as CustomEvent<GcsChatModRequest>).detail;
      if (r?.channel === channel) setDialog({ kind: r.action, target: { userId: r.userId, name: r.name, messageId: null } });
    };
    document.addEventListener(CHAT_MOD_EVENT, onRequest);
    return () => {
      for (const off of offs) off();
      document.removeEventListener(CHAT_MOD_EVENT, onRequest);
    };
  }, [realtime, channel, reload]);

  // Mute-ul expirat se ridică singur în client (jobul îl șterge și pe server).
  const remaining = useRemaining(state.mute?.until ?? null);
  useEffect(() => {
    if (remaining === 0) setState((s) => ({ ...s, mute: null }));
  }, [remaining]);
  const blockLeft = useRemaining(state.block?.until ?? null);
  useEffect(() => {
    if (blockLeft === 0) setState((s) => ({ ...s, block: null }));
  }, [blockLeft]);

  const rights = useMemo(() => new Set<GcsChatRight>(mod.rights), [mod.rights]);
  const quick = [...(["mute", "kick", "warn"] as const)].filter((r) => rights.has(r));

  const nodes = (
    <>
      {dialog && viewerId && (
        <GcsChatModDialog
          kind={dialog.kind}
          target={dialog.target}
          preset={dialog.preset}
          channel={channel}
          reasons={mod.reasons}
          everywhere={rights.has(dialog.kind === "slow" ? "slow_user" : (dialog.kind as GcsChatRight))}
          onClose={() => setDialog(null)}
          onDone={() => {
            onDone.current?.(dialog.kind);
            setDialog(null);
          }}
        />
      )}
      {card && <GcsChatModCardDialog target={card} channel={channel} onClose={() => setCard(null)} />}
    </>
  );
  return {
    mod,
    state,
    rights,
    remaining,
    /** Atributele rădăcinii camerei: acțiunile rapide pe care cardul membrului le poate oferi aici. */
    rootAttrs: quick.length > 0 ? { "data-gcs-chat-mod": quick.join(","), "data-gcs-chat-channel": channel } : {},
    open: (kind: GcsChatModKind, target: Target, preset?: number | string | null) => setDialog({ kind, target, preset }),
    openCard: (target: Target) => setCard(target),
    nodes,
  };
}

// ─── Acțiunile rapide din cardul membrului (slotul `hoverCardActions`) ─────────────────────────

const QUICK_ICONS = { mute: faCommentSlash, kick: faRightFromBracket, warn: faTriangleExclamation } as const;

/**
 * Mute / Kick / Avertisment în hover card-ul unui membru, când cardul e deschis din camera în care viewer-ul moderează
 * (rădăcina camerei are `data-gcs-chat-mod`, vezi `rootAttrs`): fiecare buton cere camerei dialogul de moderare.
 */
function GcsChatHoverActions({ ctx }: { ctx: GcsHoverCardActionContext }) {
  const tm = useTranslations("chat.mod");
  const root = ctx.anchor.closest<HTMLElement>("[data-gcs-chat-mod]");
  if (!root || ctx.isSelf) return null;
  const quick = (root.dataset.gcsChatMod ?? "").split(",").filter((a): a is GcsChatModRequest["action"] => a === "mute" || a === "kick" || a === "warn");
  if (quick.length === 0) return null;
  return (
    <span className="gcs-hoverCard__chatMod" data-testid="gcs-hover-chatmod">
      {quick.map((a) => (
        <GcsButton
          key={a}
          variant="ghost"
          size="sm"
          className="gcs-sweep"
          icon={<GcsIconSvg icon={QUICK_ICONS[a]} />}
          onClick={() => {
            const detail: GcsChatModRequest = { action: a, userId: ctx.userId, name: ctx.name, channel: root.dataset.gcsChatChannel ?? "" };
            ctx.close();
            document.dispatchEvent(new CustomEvent(CHAT_MOD_EVENT, { detail }));
          }}
          data-testid={`gcs-hover-chatmod-${a}`}
        >
          {tm(a)}
        </GcsButton>
      ))}
    </span>
  );
}

registerHoverCardActions("chat.moderation", GcsChatHoverActions, 50);

// ─── Meniul „⋯” ─────────────────────────────────────────────────────────────────────────────────

export type GcsChatModMenuHandlers = {
  reply?: () => void;
  react?: () => void;
  edit?: () => void;
  pin?: () => void;
  remove: () => void;
  hide: (hidden: boolean) => void;
  ignore?: () => void;
  report?: () => void;
  open: (kind: GcsChatModKind, preset?: number | string | null) => void;
  card: () => void;
};

type Item = { key: string; label: string; icon: GcsIconSvgProps["icon"]; tone?: "warn" | "danger"; onSelect?: () => void; href?: string; sub?: { label: string; items: { key: string; label: string; onSelect: () => void }[] }; testId?: string };

/**
 * Meniul „⋯” al unui mesaj, după drepturi. Membrii fără drepturi: Răspunde / Reacționează / Copiază / Ignoră /
 * Raportează. Staff-ul, pe mesajul lui: Editează (fără limită) / Fixează / Șterge. Staff-ul, pe al altora, grupat:
 * Mesaj (Editează, Fixează, Ascunde, Copiază textul / linkul), Membru (profilul, istoricul în chat, fișa de moderare) și
 * Moderare (Avertisment, Mute ▸, Kick ▸, Ban din chat ▸, Ban pe site…, Șterge mesajele lui ▸, Slow mode personal ▸,
 * Șterge mesajul). Acțiunile distructive sunt roșii, avertismentele portocalii; submeniurile se deschid lângă meniu.
 */
export function GcsChatModMenu(props: {
  m: GcsChatMessageView;
  own: boolean;
  channel: string;
  mod: GcsChatRoomMod;
  /** Editarea propriului mesaj e încă permisă (fereastra de 5 minute sau `edit_any`). */
  canEditOwn: boolean;
  on: GcsChatModMenuHandlers;
  onClose: () => void;
  className?: string;
  /** Ref-ul panoului (pentru închiderea la click în afară): meniul stă într-un portal, nu în mesaj. */
  panelRef?: RefObject<HTMLDivElement | null>;
}) {
  const { m, own, mod, on, onClose } = props;
  const t = useTranslations("chat.mod");
  const dur = useDuration();
  const [sub, setSub] = useState<string | null>(null);
  const box = useRef<HTMLDivElement | null>(null);
  const spot = useRef<HTMLSpanElement>(null);
  const [place, setPlace] = useState<{ top: number; left: number; maxHeight?: number; subRight: boolean } | null>(null);
  const setBox = useCallback(
    (el: HTMLDivElement | null) => {
      box.current = el;
      if (props.panelRef) (props.panelRef as { current: HTMLDivElement | null }).current = el;
    },
    [props.panelRef],
  );
  // Meniul e fix, deasupra listei (lista derulează și l-ar tăia): sub butonul „⋯”, sau deasupra lui când nu e loc;
  // urmează derularea. Lângă marginea stângă, submeniurile se deschid în dreapta.
  useLayoutEffect(() => {
    const update = () => {
      const anchor = spot.current?.parentElement?.parentElement ?? spot.current?.parentElement;
      const el = box.current;
      if (!anchor || !el) return;
      const r = anchor.getBoundingClientRect();
      const w = el.offsetWidth;
      // `offsetHeight`: fără submeniul deschis (absolut, ar mări `scrollHeight` și meniul ar sări).
      const h = el.offsetHeight;
      const vh = window.innerHeight;
      let top = r.bottom + 4;
      if (top + h > vh - 8) top = r.top - h - 4 >= 8 ? r.top - h - 4 : Math.max(8, vh - h - 8);
      const left = Math.min(Math.max(8, r.right - w), document.documentElement.clientWidth - w - 8);
      const next = { top, left, ...(h > vh - 16 ? { maxHeight: vh - 16 } : {}), subRight: left < 180 };
      setPlace((p) => (p && p.top === next.top && p.left === next.left && p.maxHeight === next.maxHeight && p.subRight === next.subRight ? p : next));
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, []);
  const rights = new Set(mod.rights);
  const author = m.author;
  const staff = rights.size > 0;
  const system = !!m.system;
  const run = (fn?: () => void) => () => {
    onClose();
    fn?.();
  };
  const copy = (text: string) =>
    void navigator.clipboard?.writeText(text).then(
      () => gcsToast({ title: t("copied") }),
      () => undefined,
    );
  const link = () => `${location.origin}/chat?c=${encodeURIComponent(props.channel)}&m=${m.id}`;

  const message: Item[] = [];
  const member: Item[] = [];
  const moderation: Item[] = [];
  const basic: Item[] = [];
  if (on.reply && !system) basic.push({ key: "reply", label: t("reply"), icon: faReply, onSelect: on.reply });
  if (on.react && !system) basic.push({ key: "react", label: t("react"), icon: faFaceSmile, onSelect: on.react });

  const canEdit = !system && !m.pro?.bot && (own ? props.canEditOwn || rights.has("edit_any") : rights.has("edit_any"));
  if (canEdit && on.edit) message.push({ key: "edit", label: t("edit"), icon: faPen, onSelect: on.edit, testId: "gcs-chatmod-edit" });
  if (rights.has("pin") && on.pin && !system) message.push({ key: "pin", label: t("pin"), icon: faThumbtack, onSelect: on.pin, testId: "gcs-chatmod-pin" });
  if (rights.has("hide") && !own)
    message.push(m.hidden ? { key: "unhide", label: t("unhide"), icon: faEye, onSelect: () => on.hide(false), testId: "gcs-chatmod-unhide" } : { key: "hide", label: t("hide"), icon: faEyeSlash, onSelect: () => on.hide(true), testId: "gcs-chatmod-hide" });
  if (m.body && !system) message.push({ key: "copyText", label: t("copyText"), icon: faCopy, onSelect: () => copy(m.body) });
  message.push({ key: "copyLink", label: t("copyLink"), icon: faLink, onSelect: () => copy(link()) });

  if (author && !own && staff) {
    member.push({ key: "profile", label: t("profile"), icon: faUser, href: memberHref(author) });
    if (mod.history) member.push({ key: "history", label: t("history"), icon: faClockRotateLeft, href: `/chat/history?member=${encodeURIComponent(author.name)}` });
    member.push({ key: "card", label: t("card"), icon: faShieldHalved, onSelect: on.card, testId: "gcs-chatmod-card" });
    const durations = (kind: "mute" | "kick" | "ban") => DURATIONS[kind].map((mins) => ({ key: mins === null ? "forever" : String(mins), label: dur(mins), onSelect: run(() => on.open(kind, mins)) }));
    if (rights.has("warn")) moderation.push({ key: "warn", label: t("warn"), icon: faTriangleExclamation, tone: "warn", onSelect: () => on.open("warn"), testId: "gcs-chatmod-warn" });
    if (rights.has("mute")) moderation.push({ key: "mute", label: t("mute"), icon: faCommentSlash, tone: "warn", sub: { label: t("muteFor"), items: durations("mute") }, testId: "gcs-chatmod-mute" });
    if (rights.has("kick")) moderation.push({ key: "kick", label: t("kick"), icon: faRightFromBracket, tone: "warn", sub: { label: t("kickFor"), items: durations("kick") }, testId: "gcs-chatmod-kick" });
    if (rights.has("ban")) moderation.push({ key: "ban", label: t("ban"), icon: faBan, tone: "danger", sub: { label: t("banFor"), items: durations("ban") }, testId: "gcs-chatmod-ban" });
    if (mod.siteBan) {
      const reason = t("siteBanReason", { excerpt: m.body.slice(0, 80), link: link() });
      moderation.push({ key: "siteBan", label: t("siteBan"), icon: faGavel, tone: "danger", href: `/admin/members/${encodeURIComponent(author.id)}?ban=1&reason=${encodeURIComponent(reason)}`, testId: "gcs-chatmod-siteban" });
    }
    if (rights.has("purge_user"))
      moderation.push({
        key: "purge",
        label: t("purge"),
        icon: faTrashArrowUp,
        tone: "danger",
        sub: { label: t("purgeFrom"), items: PURGE_WINDOWS.map((w) => ({ key: w, label: t(`window.${w}`), onSelect: run(() => on.open("purge", w)) })) },
        testId: "gcs-chatmod-purge",
      });
    if (rights.has("slow_user"))
      moderation.push({
        key: "slow",
        label: t("slow"),
        icon: faGaugeSimple,
        sub: { label: t("slowEvery"), items: SLOW_SECONDS.map((s) => ({ key: String(s), label: t("seconds", { count: s }), onSelect: run(() => on.open("slow", s)) })) },
        testId: "gcs-chatmod-slow",
      });
  }
  const canDelete = own || rights.has("delete_any");
  const tail: Item[] = [];
  if (!own && author && on.ignore && !staff) tail.push({ key: "ignore", label: t("ignore"), icon: faUserSlash, onSelect: on.ignore, testId: "gcs-chatpro-ignore" });
  if (!own && author && on.report && !system) tail.push({ key: "report", label: t("report"), icon: faFlag, onSelect: on.report, testId: "gcs-chatpro-report" });
  if (canDelete) tail.push({ key: "delete", label: t("delete"), icon: faTrashCan, tone: "danger", onSelect: on.remove, testId: "gcs-chatpro-delete" });

  // Fără drepturi (sau pe mesajul propriu): lista scurtă. Cu drepturi, pe mesajul altuia: secțiunile.
  const grouped = staff && !own && author !== null;
  const sections: { key: string; title?: string; items: Item[] }[] = grouped
    ? [
        { key: "basic", items: basic },
        { key: "message", title: t("sections.message"), items: message },
        { key: "member", title: t("sections.member"), items: member },
        { key: "moderation", title: t("sections.moderation"), items: moderation },
        { key: "tail", items: tail },
      ]
    : [{ key: "all", items: [...basic, ...message, ...tail] }];

  const focusables = () => [...(box.current?.querySelectorAll<HTMLElement>(":scope > [role=menuitem], :scope > .gcs-chatMod__wrap > [role=menuitem]") ?? [])];
  const focused = useRef(false);
  useEffect(() => {
    if (!place || focused.current) return;
    focused.current = true;
    focusables()[0]?.focus({ preventScroll: true });
  }, [place]);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const list = focusables();
    const i = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = list[(i + (e.key === "ArrowDown" ? 1 : list.length - 1)) % list.length];
      next?.focus();
    } else if (e.key === "ArrowLeft" && sub) {
      e.preventDefault();
      setSub(null);
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      (e.key === "Home" ? list[0] : list[list.length - 1])?.focus();
    }
  };

  const itemEl = (it: Item) => {
    const cls = `gcs-chatMod__item gcs-sweep${it.tone ? ` gcs-chatMod__item--${it.tone}` : ""}${sub === it.key ? " gcs-chatMod__item--on" : ""}`;
    const body = (
      <>
        <GcsIconSvg icon={it.icon} />
        <span>{it.label}</span>
        {it.sub && <GcsIconSvg icon={faChevronRight} className="gcs-chatMod__chev" />}
      </>
    );
    if (it.href)
      return (
        <a key={it.key} href={it.href} role="menuitem" className={cls} onClick={onClose} {...(it.testId ? { "data-testid": it.testId } : {})}>
          {body}
        </a>
      );
    if (it.sub)
      return (
        <span key={it.key} className="gcs-chatMod__wrap" onMouseEnter={() => setSub(it.key)} onMouseLeave={() => setSub((s) => (s === it.key ? null : s))}>
          <button
            type="button"
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={sub === it.key}
            className={cls}
            onClick={() => setSub(sub === it.key ? null : it.key)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight" || e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setSub(it.key);
                requestAnimationFrame(() => box.current?.querySelector<HTMLElement>(`[data-sub="${it.key}"] [role=menuitem]`)?.focus());
              }
            }}
            {...(it.testId ? { "data-testid": it.testId } : {})}
          >
            {body}
          </button>
          {sub === it.key && (
            <span className="gcs-chatMod__sub" role="menu" aria-label={it.sub.label} data-sub={it.key}>
              <span className="gcs-chatMod__head">{it.sub.label}</span>
              {it.sub.items.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  role="menuitem"
                  className="gcs-chatMod__item gcs-sweep"
                  onClick={s.onSelect}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowLeft" || e.key === "Escape") {
                      e.preventDefault();
                      e.stopPropagation();
                      setSub(null);
                      requestAnimationFrame(() => box.current?.querySelector<HTMLElement>(`[data-testid="${it.testId}"]`)?.focus());
                    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                      e.preventDefault();
                      e.stopPropagation();
                      const items = [...(e.currentTarget.parentElement?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
                      const j = items.indexOf(e.currentTarget);
                      items[(j + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
                    }
                  }}
                  data-testid={`gcs-chatmod-${it.key}-${s.key}`}
                >
                  {s.label}
                </button>
              ))}
            </span>
          )}
        </span>
      );
    return (
      <button key={it.key} type="button" role="menuitem" className={cls} onClick={run(it.onSelect)} {...(it.testId ? { "data-testid": it.testId } : {})}>
        {body}
      </button>
    );
  };

  const menu = (
    <div
      ref={setBox}
      className={`gcs-chatMod${place?.subRight ? " gcs-chatMod--subRight" : ""}${props.className ? ` ${props.className}` : ""}`}
      role="menu"
      aria-label={t("title")}
      onKeyDown={onKey}
      style={{ position: "fixed", top: place?.top ?? 0, left: place?.left ?? 0, visibility: place ? "visible" : "hidden", ...(place?.maxHeight ? { maxHeight: place.maxHeight, overflowY: "auto" as const } : {}) }}
      data-testid="gcs-chatmod-menu"
    >
      {sections
        .filter((s) => s.items.length > 0)
        .map((s, i) => [
          i > 0 && !s.title && <span key={`${s.key}-sep`} className="gcs-chatMod__sep" role="separator" />,
          s.title && (
            <span key={`${s.key}-head`} className="gcs-chatMod__head">
              {s.title}
            </span>
          ),
          ...s.items.map(itemEl),
        ])}
    </div>
  );
  return (
    <>
      <span ref={spot} className="gcs-chatMod__spot" aria-hidden="true" />
      {typeof document === "undefined" ? null : createPortal(menu, document.body)}
    </>
  );
}

// ─── Dialogul acțiunilor ───────────────────────────────────────────────────────────────────────────

/** Rezultatul oricărei acțiuni de moderare (doar `ok` și eroarea contează aici). */
type AnyResult = GcsResult<unknown>;

/**
 * Dialogul unei acțiuni de moderare (în pagină, niciodată `confirm()`): motivul (cele gata scrise din ACP sau scris),
 * durata / intervalul, „În tot chat-ul”, „Anunță în chat” (pornit la mute / kick / ban) și „Notifică membrul”.
 */
function GcsChatModDialog(props: {
  kind: GcsChatModKind;
  target: Target;
  preset?: number | string | null;
  channel: string;
  reasons: string[];
  everywhere: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const { kind, target, channel } = props;
  const t = useTranslations("chat.mod");
  const dur = useDuration();
  const errorMessage = useErrorMessage();
  const [reason, setReason] = useState("");
  const initialMinutes = typeof props.preset === "number" || props.preset === null ? props.preset : kind === "mute" ? 15 : kind === "kick" ? 15 : kind === "ban" ? 1440 : 60;
  const [minutes, setMinutes] = useState<number | null>(kind === "slow" ? 60 : (initialMinutes ?? null));
  const [seconds, setSeconds] = useState(kind === "slow" && typeof props.preset === "number" ? props.preset : 30);
  const [window, setWindow] = useState<(typeof PURGE_WINDOWS)[number]>(typeof props.preset === "string" && (PURGE_WINDOWS as readonly string[]).includes(props.preset) ? (props.preset as (typeof PURGE_WINDOWS)[number]) : "1h");
  const [points, setPoints] = useState(1);
  const [all, setAll] = useState(false);
  const [announce, setAnnounce] = useState(kind === "mute" || kind === "kick" || kind === "ban");
  const [notify, setNotify] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const options: (number | null)[] = kind === "mute" || kind === "kick" || kind === "ban" ? DURATIONS[kind] : kind === "slow" ? SLOW_MINUTES : [];
  const needsReason = kind === "warn";
  const danger = kind === "ban" || kind === "purge";
  const submit = async () => {
    setBusy(true);
    const base = { userId: target.userId, channel, reason: reason.trim(), messageId: target.messageId };
    const res: AnyResult = await ((
      kind === "warn"
        ? warnChatUser({ ...base, points, announce })
        : kind === "mute"
          ? muteChatUser({ ...base, minutes, everywhere: all, announce, notify })
          : kind === "kick"
            ? kickChatUser({ ...base, minutes: minutes ?? 15, everywhere: all, announce, notify })
            : kind === "ban"
              ? banChatUser({ ...base, minutes, announce, notify })
              : kind === "slow"
                ? slowChatUser({ ...base, seconds, minutes, notify })
                : purgeChatUser({ userId: target.userId, channel, window, reason: reason.trim() })) as Promise<AnyResult>
    );
    setBusy(false);
    if (!res.ok) return setError(errorMessage(res.error as GcsErrorPayload));
    gcsToast({ title: t(`done.${kind}`, { name: target.name }) });
    props.onDone();
  };

  return (
    <GcsModal title={t(`dialog.${kind}`, { name: target.name })} onClose={props.onClose} closeLabel={t("cancel")} size="sm" className="gcs-chatModDialog">
      <form
        className="gcs-chatModDialog__form"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        data-testid={`gcs-chatmod-dialog-${kind}`}
      >
        {target.messageId && target.body && (kind === "warn" || kind === "purge") && (
          <blockquote className="gcs-chatModDialog__quote">
            {kind === "warn" && <span className="gcs-chatModDialog__note">{t("evidence")}</span>}
            {target.body.slice(0, 200)}
          </blockquote>
        )}
        {(kind === "mute" || kind === "kick" || kind === "ban" || kind === "slow") && (
          <fieldset className="gcs-chatModDialog__group">
            <legend>{kind === "slow" ? t("interval") : t("duration")}</legend>
            {kind === "slow" && (
              <div className="gcs-chatModDialog__chips" role="radiogroup" aria-label={t("interval")}>
                {SLOW_SECONDS.map((s) => (
                  <button key={s} type="button" role="radio" aria-checked={seconds === s} className={`gcs-chatModDialog__chip gcs-sweep${seconds === s ? " gcs-chatModDialog__chip--on" : ""}`} onClick={() => setSeconds(s)}>
                    {t("seconds", { count: s })}
                  </button>
                ))}
              </div>
            )}
            <div className="gcs-chatModDialog__chips" role="radiogroup" aria-label={t("duration")}>
              {options.map((o) => (
                <button key={String(o)} type="button" role="radio" aria-checked={minutes === o} className={`gcs-chatModDialog__chip gcs-sweep${minutes === o ? " gcs-chatModDialog__chip--on" : ""}`} onClick={() => setMinutes(o)} data-testid={`gcs-chatmod-dur-${o ?? "forever"}`}>
                  {dur(o)}
                </button>
              ))}
            </div>
          </fieldset>
        )}
        {kind === "purge" && (
          <fieldset className="gcs-chatModDialog__group">
            <legend>{t("purgeFrom")}</legend>
            <div className="gcs-chatModDialog__chips" role="radiogroup" aria-label={t("purgeFrom")}>
              {PURGE_WINDOWS.map((w) => (
                <button key={w} type="button" role="radio" aria-checked={window === w} className={`gcs-chatModDialog__chip gcs-sweep${window === w ? " gcs-chatModDialog__chip--on" : ""}`} onClick={() => setWindow(w)}>
                  {t(`window.${w}`)}
                </button>
              ))}
            </div>
          </fieldset>
        )}
        {kind === "warn" && (
          <fieldset className="gcs-chatModDialog__group">
            <legend>{t("points")}</legend>
            <div className="gcs-chatModDialog__chips" role="radiogroup" aria-label={t("points")}>
              {[1, 2, 3, 5].map((p) => (
                <button key={p} type="button" role="radio" aria-checked={points === p} className={`gcs-chatModDialog__chip gcs-sweep${points === p ? " gcs-chatModDialog__chip--on" : ""}`} onClick={() => setPoints(p)}>
                  {p}
                </button>
              ))}
            </div>
          </fieldset>
        )}
        <label className="gcs-field gcs-chatModDialog__reason">
          {t("reason")}
          <input className="gcs-input" value={reason} maxLength={200} required={needsReason} placeholder={t("reasonPlaceholder")} onChange={(e) => setReason(e.target.value)} data-testid="gcs-chatmod-reason" />
        </label>
        {props.reasons.length > 0 && (
          <div className="gcs-chatModDialog__chips gcs-chatModDialog__presets" aria-label={t("presets")}>
            {props.reasons.map((r) => (
              <button key={r} type="button" className={`gcs-chatModDialog__chip gcs-sweep${reason === r ? " gcs-chatModDialog__chip--on" : ""}`} onClick={() => setReason(r)}>
                {r}
              </button>
            ))}
          </div>
        )}
        {(kind === "mute" || kind === "kick") && props.everywhere && (
          <label className="gcs-checkRow">
            <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
            {t("everywhere")}
          </label>
        )}
        {kind !== "slow" && kind !== "purge" && (
          <label className="gcs-checkRow">
            <input type="checkbox" checked={announce} onChange={(e) => setAnnounce(e.target.checked)} data-testid="gcs-chatmod-announce" />
            {t("announce")}
          </label>
        )}
        {kind !== "warn" && kind !== "purge" && (
          <label className="gcs-checkRow">
            <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} data-testid="gcs-chatmod-notify" />
            {t("notify")}
          </label>
        )}
        {error && (
          <p role="alert" className="gcs-chatModDialog__error">
            {error}
          </p>
        )}
        <div className="gcs-dialog__actions">
          <GcsButton type="button" variant="ghost" onClick={props.onClose}>
            {t("cancel")}
          </GcsButton>
          <GcsButton type="submit" variant="primary" className={danger ? "gcs-chatModDialog__danger" : undefined} disabled={busy || (needsReason && !reason.trim())} data-testid="gcs-chatmod-confirm">
            {t(`confirm.${kind}`)}
          </GcsButton>
        </div>
      </form>
    </GcsModal>
  );
}

// ─── Fișa de moderare ────────────────────────────────────────────────────────────────────────────

/** Panoul din pagină cu avertismentele, sancțiunile active (cu „Ridică”) și ultimele acțiuni asupra membrului. */
function GcsChatModCardDialog({ target, channel, onClose }: { target: Target; channel: string; onClose: () => void }) {
  const t = useTranslations("chat.mod");
  const format = useFormatter();
  const errorMessage = useErrorMessage();
  const [card, setCard] = useState<GcsChatModCard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    void loadChatModCard({ userId: target.userId, channel }).then((r) => (r.ok ? setCard(r.data) : setError(errorMessage(r.error))));
  }, [target.userId, channel, errorMessage]);
  useEffect(load, [load]);
  const when = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "short", timeStyle: "short" });
  return (
    <GcsModal title={t("cardTitle", { name: target.name })} icon={<GcsIconSvg icon={faShieldHalved} />} onClose={onClose} closeLabel={t("close")} size="md">
      <div className="gcs-chatModCard" data-testid="gcs-chatmod-cardpanel">
        {error && <p role="alert">{error}</p>}
        {!card && !error && <p className="gcs-muted">…</p>}
        {card && (
          <>
            <section>
              <h3 className="gcs-chatModCard__title">
                {t("warnings")} <span className="gcs-chatModCard__count">{t("activePoints", { count: card.activePoints })}</span>
              </h3>
              {card.warnings.length === 0 ? (
                <p className="gcs-muted">{t("none")}</p>
              ) : (
                <ul className="gcs-chatModCard__list">
                  {card.warnings.map((w) => (
                    <li key={w.id}>
                      <b>+{w.points}</b> {w.reason} <span className="gcs-muted">· {when(w.createdAt)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section>
              <h3 className="gcs-chatModCard__title">{t("sanctions")}</h3>
              {card.sanctions.length === 0 ? (
                <p className="gcs-muted">{t("none")}</p>
              ) : (
                <ul className="gcs-chatModCard__list">
                  {card.sanctions.map((s) => (
                    <li key={s.ref}>
                      <b>{t(`kinds.${s.kind}`)}</b> {s.reason && `· ${s.reason}`} <span className="gcs-muted">· {s.until ? t("until", { time: when(s.until) }) : t("dur.forever")}</span>
                      <GcsButton size="sm" variant="ghost" className="gcs-sweep" onClick={() => void liftChatSanction({ ref: s.ref }).then((r) => (r.ok ? load() : setError(errorMessage(r.error))))} data-testid="gcs-chatmod-lift">
                        {t("lift")}
                      </GcsButton>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section>
              <h3 className="gcs-chatModCard__title">{t("recent")}</h3>
              {card.log.length === 0 ? (
                <p className="gcs-muted">{t("none")}</p>
              ) : (
                <ul className="gcs-chatModCard__list">
                  {card.log.map((l) => (
                    <li key={l.id}>
                      <b>{t(`actions.${l.action}`)}</b> {l.reason && `· ${l.reason}`} <span className="gcs-muted">· {l.actor?.name ?? "—"} · {when(l.createdAt)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </GcsModal>
  );
}

// ─── Liniile din listă: sistem, rezultate efemere ──────────────────────────────────────────────────────

const name = (u: { id: string; name: string; nameKey?: string | null } | null, fallback: string) =>
  u ? <GcsMemberName userId={u.id} name={u.name} nameKey={u.nameKey ?? undefined} href={memberHref(u as Parameters<typeof memberHref>[0])} /> : <span className="gcs-deletedMember">{fallback}</span>;

/** Textul unei linii de sistem (în chat și în istoric), cu numele stilizate. */
export function GcsChatSystemText({ system: s, author, deletedMember }: { system: GcsChatSystemLine; author: GcsChatMessageView["author"]; deletedMember: string }) {
  const t = useTranslations("chat.mod");
  const dur = useDuration();
  const target = () => name(s.target, deletedMember);
  const actor = () => name(author, deletedMember);
  const suffix = s.reason ? `: ${s.reason}` : "";
  let text: ReactNode;
  if (s.kind === "grant") {
    const extra = [...(s.rights && s.rights.length > 0 ? [s.rights.map((r) => t(`rights.${r}`)).join(", ")] : []), ...(s.minutes ? [dur(s.minutes)] : [])];
    text = (
      <>
        {t.rich("system.grant", { target, actor })}
        {extra.length > 0 && ` · ${extra.join(" · ")}`}
      </>
    );
  } else if (s.kind === "revoke") text = t.rich("system.revoke", { target, actor });
  else text = t.rich(`system.${s.kind}`, { target, duration: dur(s.minutes), suffix });
  return <>{text}</>;
}

/** Linia verde a moderării („X a primit mute 15 minute: spam”, „X a primit acces de moderator în chat de la Y · …”). */
export function GcsChatSystemLine({ m, time, deletedMember }: { m: GcsChatMessageView & { system: GcsChatSystemLine }; time: string; deletedMember: string }) {
  return (
    <li className="gcs-chatSys" data-testid="gcs-chat-sysline" data-kind={m.system.kind} data-message-id={m.id}>
      <span className="gcs-chatSys__icon" aria-hidden="true">
        <GcsIconSvg icon={faShieldHalved} />
      </span>
      <span className="gcs-chatSys__text">
        <GcsChatSystemText system={m.system} author={m.author} deletedMember={deletedMember} />
      </span>
      <time className="gcs-chatSys__time" dateTime={m.createdAt} suppressHydrationWarning>
        {time}
      </time>
    </li>
  );
}

const grantLine = (g: GcsChatGrantView, t: ReturnType<typeof useTranslations>, when: (iso: string) => string) =>
  [g.rights.map((r) => t(`rights.${r}`)).join(", "), g.rooms.length > 0 ? g.rooms.map((r) => `#${r}`).join(" ") : t("allRooms"), g.expiresAt ? t("until", { time: when(g.expiresAt) }) : t("dur.forever")].join(" · ");

/** Rezultatul unei comenzi (`/acces`, `/revoca`): doar pentru cine a scris-o, se poate închide. */
export function GcsChatEphemeralLine({ e, onDismiss }: { e: GcsChatEphemeral; onDismiss: () => void }) {
  const t = useTranslations("chat.mod");
  const format = useFormatter();
  const when = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "short", timeStyle: "short" });
  let body: ReactNode;
  if (e.kind === "granted") body = <>{t.rich("ephemeral.granted", { target: () => name(e.grant.user, "") })} · {grantLine(e.grant, t, when)}</>;
  else if (e.kind === "revoked") body = t.rich("ephemeral.revoked", { target: () => name(e.user, "") });
  else
    body = (
      <>
        <b>{t("ephemeral.list", { count: e.grants.length })}</b>
        {e.grants.length === 0 ? (
          <span> {t("ephemeral.listEmpty")}</span>
        ) : (
          <ul className="gcs-chatSys__list">
            {e.grants.map((g) => (
              <li key={g.id}>
                {name(g.user, "")} · {grantLine(g, t, when)}
              </li>
            ))}
          </ul>
        )}
      </>
    );
  return (
    <li className="gcs-chatSys gcs-chatSys--ephemeral" data-testid="gcs-chat-ephemeral" data-kind={e.kind}>
      <span className="gcs-chatSys__icon" aria-hidden="true">
        <GcsIconSvg icon={faShieldHalved} />
      </span>
      <span className="gcs-chatSys__text">
        {body}
        <span className="gcs-chatSys__only">{t("ephemeral.onlyYou")}</span>
      </span>
      <button type="button" className="gcs-chatSys__dismiss gcs-sweep" onClick={onDismiss} aria-label={t("close")} title={t("close")}>
        ×
      </button>
    </li>
  );
}

/** Eticheta „ASCUNS” a unui mesaj ascuns (doar staff-ul îl vede), cu cine l-a ascuns. */
export function GcsChatHiddenTag({ m }: { m: GcsChatMessageView }) {
  const t = useTranslations("chat.mod");
  if (!m.hidden) return null;
  return (
    <span className="gcs-chatHiddenTag" data-testid="gcs-chat-hidden-tag" title={m.hidden.by ? t("hiddenBy", { name: m.hidden.by.name }) : undefined}>
      {t("hiddenTag")}
      {m.hidden.by && <span className="gcs-chatHiddenTag__by"> · {m.hidden.by.name}</span>}
    </span>
  );
}

// ─── Starea viewer-ului: mute (cu numărătoare), kick / ban, slow mode ──────────────────────────────────────

/** „Ai mute până la HH:MM” cu numărătoarea inversă (sau permanent), în locul câmpului de scris. */
export function GcsChatMutedNote({ mute, remaining }: { mute: { reason: string; until: string | null }; remaining: number | null }) {
  const t = useTranslations("chat.mod");
  return (
    <p className="gcs-chat__note gcs-chat__note--warn gcs-chatMuted" role="status" data-testid="gcs-chat-muted">
      <GcsIconSvg icon={faCommentSlash} />
      <span suppressHydrationWarning>
        {mute.until ? t("mutedUntil", { time: new Date(mute.until).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) }) : t("mutedForever")}
        {mute.reason && ` · ${mute.reason}`}
      </span>
      {remaining !== null && (
        <span className="gcs-chatMuted__left" role="timer" aria-live="off" data-testid="gcs-chat-mute-countdown" suppressHydrationWarning>
          {clock(remaining)}
        </span>
      )}
    </p>
  );
}

/** Panoul camerei pentru un membru scos (kick) sau banat din chat: motivul și cât mai durează. */
export function GcsChatBlocked({ block }: { block: NonNullable<GcsChatViewerState["block"]> }) {
  const t = useTranslations("chat.mod");
  const left = useRemaining(block.until);
  return (
    <div className="gcs-chatBlocked" role="alert" data-testid="gcs-chat-blocked" data-kind={block.kind}>
      <GcsIconSvg icon={block.kind === "ban" ? faBan : faRightFromBracket} className="gcs-chatBlocked__icon" />
      <strong>{block.kind === "ban" ? t("blocked.ban") : t("blocked.kick")}</strong>
      {block.reason && <span>{t("blocked.reason", { reason: block.reason })}</span>}
      <span className="gcs-muted" suppressHydrationWarning>
        {block.until ? t("until", { time: new Date(block.until).toLocaleString([], { dateStyle: "short", timeStyle: "short" }) }) : t("dur.forever")}
        {left !== null && ` · ${clock(left)}`}
      </span>
    </div>
  );
}

/** Hide / unhide din meniu, cu eroarea afișată de cameră. */
export function hideMessage(id: number, hidden: boolean, onError: (e: GcsErrorPayload) => void): void {
  void hideChatMessage({ id, hidden }).then((r) => {
    if (!r.ok) onError(r.error);
  });
}

/** Raportarea unui mesaj moderatorilor (chat-ul standard și Chat Pro): motivul, în pagină. */
export function GcsChatReportDialog({ id, onClose }: { id: number; onClose: () => void }) {
  const t = useTranslations("chatPro.report");
  const tc = useTranslations("chat.ui");
  const errorMessage = useErrorMessage();
  const [reason, setReason] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  return (
    <GcsModal title={t("title")} onClose={onClose} closeLabel={tc("close")} size="sm">
      <form
        className="gcs-chatPro__reportForm"
        onSubmit={(e) => {
          e.preventDefault();
          void reportChat({ id, reason: reason.trim() }).then((r) => setStatus(r.ok ? t("done") : errorMessage(r.error)));
        }}
      >
        <label className="gcs-field">
          {t("reason")}
          <textarea className="gcs-input" rows={3} minLength={3} maxLength={500} required value={reason} onChange={(e) => setReason(e.target.value)} data-testid="gcs-chatpro-report-reason" />
        </label>
        {status && <p role="status">{status}</p>}
        <GcsButton type="submit" variant="primary" disabled={reason.trim().length < 3} data-testid="gcs-chatpro-report-send">
          {t("send")}
        </GcsButton>
      </form>
    </GcsModal>
  );
}

/** Drepturile și duratele sugerate în paleta lui `/acces`. */
const ACCESS_RIGHTS = ["mute,kick,warn", "mute,kick", "mute", "kick", "warn", "hide", "delete", "pin", "ban", "slow", "purge", "edit", "toate"];
const ACCESS_DURATIONS = ["1h", "12h", "1d", "7d", "30d"];

/** `/acces` și `/revoca` în paleta „/” (doar pentru cine poate da acces de moderator), cu sugestiile argumentelor. */
export function useAccessCommands(rooms: string[]): GcsComposerCommand[] {
  const t = useTranslations("chat.commands");
  return useMemo(
    () => [
      {
        name: "acces",
        usage: t("acces.usage"),
        description: t("acces.description"),
        examples: ["/acces @Kaze", "/acces @Kaze mute,kick 7d", "/acces @Kaze #general"],
        hints: [
          { key: "rights", label: t("rights"), items: ACCESS_RIGHTS.map((value) => ({ value })) },
          { key: "durations", label: t("durations"), items: ACCESS_DURATIONS.map((value) => ({ value })) },
          { key: "rooms", label: t("rooms"), items: rooms.map((r) => ({ value: `#${r}` })) },
        ],
      },
      { name: "revoca", usage: t("revoca.usage"), description: t("revoca.description"), examples: ["/revoca @Kaze"] },
    ],
    [t, rooms],
  );
}
