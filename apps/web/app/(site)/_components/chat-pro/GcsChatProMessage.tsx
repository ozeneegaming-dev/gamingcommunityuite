"use client";

import { faFaceSmile } from "@fortawesome/free-regular-svg-icons";
import { faEllipsis, faExpand, faGlobe, faReply, faSeedling, faTrophy } from "@fortawesome/free-solid-svg-icons";
import type { GcsChatMessageView, GcsChatProBot, GcsChatProPrefs, GcsRpsChoice } from "@gcs/modules";
import { GcsAvatar, GcsBadgeArt, GcsIconSvg, GcsMemberName, type GcsIconSvgProps } from "@gcs/ui";
import { useTranslations } from "next-intl";
import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { memberHref } from "@/lib/forum-urls";
import { openImageViewer } from "@/lib/image-viewer";
import { GcsChatMedia } from "../chat/GcsChatMedia";
import { GcsChatHiddenTag, GcsChatModMenu, type GcsChatModKind, type GcsChatRoomMod } from "../chat/GcsChatModeration";
import { useDismiss } from "../chat/use-dismiss";

export type GcsChatProMessageActions = {
  reply: () => void;
  react: (reactionId: number) => void;
  edit: () => void;
  remove: () => void;
  pin: () => void;
  hide: (hidden: boolean) => void;
  /** Un dialog de moderare (avertisment, mute, kick, ban, slow mode, ștergerea mesajelor lui), cu durata aleasă. */
  moderate: (kind: GcsChatModKind, preset?: number | string | null) => void;
  card: () => void;
  ignore: () => void;
  report: () => void;
  mention: (name: string) => void;
  answerRps: (choice: GcsRpsChoice) => void;
};

const RPS: { key: GcsRpsChoice; emoji: string }[] = [
  { key: "rock", emoji: "✊" },
  { key: "paper", emoji: "✋" },
  { key: "scissors", emoji: "✌️" },
];
const previews = new Map<string, Promise<{ host: string; title: string; site: string | null } | null>>();

/** Previzualizarea unui link (titlul și site-ul), cerută serverului doar când mesajul ajunge pe ecran. */
function GcsLinkPreview({ url }: { url: string }) {
  const ref = useRef<HTMLAnchorElement>(null);
  const [data, setData] = useState<{ host: string; title: string; site: string | null } | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      if (!previews.has(url)) {
        previews.set(
          url,
          fetch(`/api/chat-pro/preview?url=${encodeURIComponent(url)}`)
            .then((r) => (r.ok ? r.json() : { preview: null }))
            .then((b: { preview: { host: string; title: string; site: string | null } | null }) => b.preview)
            .catch(() => null),
        );
      }
      void previews.get(url)!.then(setData);
    });
    io.observe(el);
    return () => io.disconnect();
  }, [url]);
  return (
    <a ref={ref} href={url} target="_blank" rel="nofollow ugc noopener" className="gcs-chatPro__preview" hidden={!data} data-testid="gcs-chatpro-preview">
      <GcsIconSvg icon={faGlobe} />
      <span>
        <strong>{data?.title}</strong>
        <span>{data?.site ?? data?.host}</span>
      </span>
    </a>
  );
}

/** Rezultatul unei comenzi a botului, ca un card. */
function GcsBotCard({ bot, name, viewerId, onAnswer }: { bot: GcsChatProBot; name: string; viewerId: string | null; onAnswer: (c: GcsRpsChoice) => void }) {
  const t = useTranslations("chatPro.bot");
  let body: ReactNode;
  if (bot.command === "roll") body = t("roll", { name, result: bot.result, max: bot.max });
  else if (bot.command === "iq") body = `${t("iq", { name, value: bot.value })} ${t(bot.value >= 140 ? "iqHigh" : bot.value >= 90 ? "iqMid" : "iqLow")}`;
  else if (bot.command === "birthday")
    body =
      bot.users.length > 0
        ? t.rich("birthday", {
            names: () =>
              bot.users.map((u, i) => (
                <Fragment key={u.id}>
                  {i > 0 && ", "}
                  <GcsMemberName userId={u.id} name={u.name} nameKey={u.nameKey} href={memberHref(u)} />
                </Fragment>
              )),
          })
        : t("noBirthday");
  else {
    const emoji = (c: GcsRpsChoice) => RPS.find((r) => r.key === c)!.emoji;
    body = (
      <>
        {t("rps", { name, opponent: bot.opponent.name })}
        {bot.state === "open" && viewerId === bot.opponent.id && (
          <span className="gcs-chatPro__rps" role="group" aria-label={t("rpsChoose")}>
            {RPS.map((r) => (
              <button key={r.key} type="button" className="gcs-chatPro__rpsBtn" aria-label={t(`rpsChoice.${r.key}`)} title={t(`rpsChoice.${r.key}`)} onClick={() => onAnswer(r.key)} data-testid={`gcs-chatpro-rps-${r.key}`}>
                {r.emoji}
              </button>
            ))}
          </span>
        )}
        {bot.state === "open" && viewerId !== bot.opponent.id && <span className="gcs-chatPro__botNote"> {t("rpsWaiting")}</span>}
        {bot.state === "expired" && <span className="gcs-chatPro__botNote"> {t("rpsExpired")}</span>}
        {bot.state === "done" && bot.result && (
          <span className="gcs-chatPro__botResult" data-testid="gcs-chatpro-rps-result">
            {emoji(bot.result.challenger)} vs {emoji(bot.result.opponent)} —{" "}
            {bot.result.winner === "draw" ? t("rpsDraw") : t("rpsWinner", { name: bot.result.winner === "challenger" ? name : bot.opponent.name })}
          </span>
        )}
      </>
    );
  }
  return (
    <div className="gcs-chatPro__bot" data-testid="gcs-chatpro-bot" data-command={bot.command}>
      <span className="gcs-chatPro__botTag">{t("tag")}</span>
      <span>{body}</span>
    </div>
  );
}

/**
 * Un mesaj în Chat Pro: avatarul, numele (porecla, culoarea grupului; click → mențiune), insignele („Primul mesaj”,
 * câștigătorul clasamentului, badge-urile alese), ora și „(editat)”, citatul răspunsului, textul sau cardul botului,
 * media („Mărește media” → vizualizatorul de imagini), previzualizarea linkului și reacțiile. Uneltele: Răspunde,
 * Reacționează și meniul „⋯” (editează, fixează, mute, șterge, ignoră, raportează).
 */
export function GcsChatProMessage(props: {
  m: GcsChatMessageView;
  own: boolean;
  mentioned: boolean;
  /** Continuarea mesajelor aceluiași autor (aranjamentul Discord): fără avatar și nume. */
  grouped: boolean;
  viewerId: string | null;
  prefs: GcsChatProPrefs;
  allowImages: boolean;
  allowYoutube: boolean;
  hideAvatar: boolean;
  time: string;
  labels: { edited: string; deletedMember: string };
  reactions: { id: number; symbol: string; label: string }[];
  can: { react: boolean; edit: boolean; ignore: boolean; report: boolean; reply: boolean };
  /** Meniul de moderare al camerei (drepturile viewer-ului) și camera. */
  mod: GcsChatRoomMod;
  channel: string;
  editor?: ReactNode;
  actions: GcsChatProMessageActions;
}) {
  const { m, own, mentioned, grouped, viewerId, prefs, can, actions } = props;
  const t = useTranslations("chatPro.message");
  const tm = useTranslations("chat.ui");
  const [menu, setMenu] = useState<"react" | "more" | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setMenu(null), []);
  useDismiss(menu !== null, menuRef, close, triggerRef);
  const author = m.author;
  const name = m.pro?.nickname ?? author?.name ?? props.labels.deletedMember;
  const bot = m.pro?.bot ?? null;
  const symbols = new Map(props.reactions.map((r) => [r.id, r]));
  const images = [...m.files.filter((f) => f.kind === "image").map((f) => `/files/${f.id}`), ...m.embeds.filter((e) => e.kind === "image").map((e) => (e.kind === "image" ? e.url : ""))].filter(Boolean);
  const media = props.allowImages ? images : [];
  const link = prefs.linkPreviews && !bot ? (/https?:\/\/[^\s<>"']+/.exec(m.body)?.[0]?.replace(/[.,!?;:)\]}]+$/, "") ?? null) : null;
  const linkIsMedia = link !== null && (m.embeds.some((e) => (e.kind === "image" ? e.url === link : link.includes(e.id))) || /\.(?:png|jpe?g|gif|webp)(?:\?|$)/i.test(link));

  const tool = (label: string, icon: GcsIconSvgProps["icon"], onClick: () => void, extra: { testId?: string; trigger?: boolean; expanded?: boolean } = {}) => (
    <button
      type="button"
      className="gcs-chatPro__tool gcs-sweep"
      aria-label={label}
      title={label}
      onClick={onClick}
      {...(extra.trigger ? { ref: triggerRef, "aria-haspopup": "menu" as const, "aria-expanded": extra.expanded } : {})}
      {...(extra.testId ? { "data-testid": extra.testId } : {})}
    >
      <GcsIconSvg icon={icon} />
    </button>
  );
  const hasMore = viewerId !== null;

  return (
    <li
      className={`gcs-chatPro__msg${own ? " gcs-chatPro__msg--own" : ""}${mentioned ? " gcs-chatPro__msg--mention" : ""}${grouped ? " gcs-chatPro__msg--grouped" : ""}${bot ? " gcs-chatPro__msg--bot" : ""}${m.hidden ? " gcs-chatPro__msg--hidden" : ""}`}
      data-testid="gcs-chat-msg"
      data-message-id={m.id}
      data-gcs-caption-author={name}
      data-gcs-caption-date={m.createdAt}
    >
      {!props.hideAvatar &&
        (author && !grouped ? (
          <a href={memberHref(author)} className="gcs-chatPro__avatar" tabIndex={-1} aria-hidden="true" data-testid="gcs-chat-avatar">
            <GcsAvatar name={author.name} userId={author.id} src={author.image ?? undefined} size="m" frame={author.frameKey ?? undefined} />
          </a>
        ) : (
          <span className="gcs-chatPro__avatar" aria-hidden="true" />
        ))}
      <div className="gcs-chatPro__main">
        {!grouped && (
          <div className="gcs-chatPro__meta">
            {author ? (
              <GcsMemberName
                userId={author.id}
                name={author.name}
                label={name}
                nameKey={author.nameKey}
                className="gcs-chat__name gcs-chatPro__name"
                title={tm("mentionHint", { name })}
                onClick={() => actions.mention(name)}
                data-testid="gcs-chat-name"
              />
            ) : (
              <span className="gcs-deletedMember" data-testid="gcs-deleted-member">
                {props.labels.deletedMember}
              </span>
            )}
            {m.pro?.first && (
              <span className="gcs-chatPro__tag gcs-chatPro__tag--first" data-testid="gcs-chatpro-first">
                <GcsIconSvg icon={faSeedling} />
                {t("first")}
              </span>
            )}
            {m.pro?.winner && (
              <span className="gcs-chatPro__tag gcs-chatPro__tag--winner" title={t("winner")} data-testid="gcs-chatpro-winner">
                <GcsIconSvg icon={faTrophy} />
                <span className="gcs-chatPro__tagText">{t("winner")}</span>
              </span>
            )}
            {m.pro?.badges.map((b) => (
              <span key={b.key} className="gcs-chatPro__badge" title={b.name} data-testid="gcs-chatpro-badge">
                <GcsBadgeArt badge={b} size={16} />
              </span>
            ))}
            <time className="gcs-chatPro__time" dateTime={m.createdAt} suppressHydrationWarning>
              {props.time}
            </time>
            {m.editedAt && <span className="gcs-chatPro__edited">({props.labels.edited})</span>}
            <GcsChatHiddenTag m={m} />
          </div>
        )}
        {m.pro?.replyTo && (
          <blockquote className="gcs-chatPro__quote" data-testid="gcs-chatpro-quote">
            <GcsIconSvg icon={faReply} />
            <strong>{m.pro.replyTo.author ?? props.labels.deletedMember}</strong>
            <span>{m.pro.replyTo.snippet}</span>
          </blockquote>
        )}
        {props.editor ??
          (bot ? (
            <GcsBotCard bot={bot} name={name} viewerId={viewerId} onAnswer={actions.answerRps} />
          ) : (
            // HTML-ul vine de la server: textul escapat de `renderChatText` (doar linkurile http(s) devin <a>) și emoticoanele
            // (`renderEmotes`: coduri [a-z0-9_] și adrese /files/<id> din baza de date). Nimic din text nu ajunge nescapat.
            m.body && <div className="gcs-chatPro__text" dangerouslySetInnerHTML={{ __html: m.html }} />
          ))}
        <GcsChatMedia
          files={m.files ?? []}
          embeds={m.embeds ?? []}
          allowImages={props.allowImages}
          allowYoutube={props.allowYoutube}
          pro={{ autoplayGifs: prefs.autoplayGifs, volume: prefs.voiceVolume, collapse: prefs.mobileMediaButtons }}
        />
        {link && !linkIsMedia && <GcsLinkPreview url={link} />}
        {m.reactions.length > 0 && (
          <span className="gcs-chat__reactions" data-testid="gcs-chat-reactions">
            {m.reactions.map((r) => {
              const opt = symbols.get(r.reactionId);
              if (!opt) return null;
              const mine = m.mine.includes(r.reactionId);
              return (
                <button
                  key={r.reactionId}
                  type="button"
                  className={`gcs-chat__reaction${mine ? " gcs-chat__reaction--mine" : ""}`}
                  aria-pressed={mine}
                  aria-label={`${opt.label}: ${r.count}`}
                  disabled={!can.react}
                  onClick={() => actions.react(r.reactionId)}
                >
                  {opt.symbol} {r.count}
                </button>
              );
            })}
          </span>
        )}
      </div>
      <div className={`gcs-chatPro__tools${menu ? " gcs-chatPro__tools--open" : ""}`}>
        {can.reply && tool(t("reply"), faReply, actions.reply, { testId: "gcs-chatpro-reply" })}
        {can.react && props.reactions.length > 0 && tool(t("react"), faFaceSmile, () => setMenu(menu === "react" ? null : "react"), { trigger: menu === "react", expanded: menu === "react" })}
        {media.length > 0 && tool(t("enlarge"), faExpand, () => openImageViewer(media.map((src) => ({ src, caption: { author: name, date: m.createdAt } }))), { testId: "gcs-chatpro-enlarge" })}
        {hasMore && tool(t("more"), faEllipsis, () => setMenu(menu === "more" ? null : "more"), { trigger: menu === "more", expanded: menu === "more", testId: "gcs-chatpro-more" })}
        {menu === "more" && (
          <div className="gcs-chatMod__anchor">
            <GcsChatModMenu
              panelRef={menuRef}
              m={m}
              own={own}
              channel={props.channel}
              mod={props.mod}
              canEditOwn={can.edit}
              onClose={close}
              on={{
                ...(can.reply && !bot ? { reply: actions.reply } : {}),
                ...(can.react && props.reactions.length > 0 ? { react: () => setMenu("react") } : {}),
                ...(m.body && !bot ? { edit: actions.edit } : {}),
                pin: actions.pin,
                remove: actions.remove,
                hide: actions.hide,
                ...(can.ignore ? { ignore: actions.ignore } : {}),
                ...(can.report ? { report: actions.report } : {}),
                open: actions.moderate,
                card: actions.card,
              }}
            />
          </div>
        )}
        {menu === "react" && (
          <div ref={menuRef} className="gcs-chatPro__menu" role="menu" aria-label={t("react")}>
            {menu === "react" &&
              props.reactions.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  role="menuitem"
                  className="gcs-chatPro__reactPick gcs-sweep"
                  title={r.label}
                  aria-label={r.label}
                  onClick={() => {
                    setMenu(null);
                    actions.react(r.id);
                  }}
                >
                  {r.symbol}
                </button>
              ))}
          </div>
        )}
      </div>
    </li>
  );
}
