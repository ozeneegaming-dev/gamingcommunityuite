import { GcsAvatar, GcsCard, GcsMemberName } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { currentActor } from "@/lib/actor";
import { memberHref } from "@/lib/forum-urls";
import { namesHtml } from "@/lib/member-names";
import { userContentHtml } from "@/lib/seo";
import { services } from "@/lib/services";
import { GcsHistoryActions, GcsHistoryIdChip, GcsHistoryJump, GcsHistorySystem } from "../../_components/chat-pro/GcsChatHistoryParts";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("chatPro.historyPage"))("title"), robots: { index: false } };
}

type Search = { q?: string; member?: string; from?: string; to?: string; channel?: string; page?: string; hidden?: string };
const FILTER_KEYS = ["q", "member", "from", "to", "channel", "hidden"] as const;

/**
 * `/chat/history` (Chat Pro): antetul (iconița, titlul, „Înapoi la chat”), cele trei totaluri, căutarea (mesaj, membru,
 * de la, până la; camerele ca chip-uri; staff-ul: „Arată și ascunse” și „Exportă CSV”), paginarea numerotată cu „Sari la
 * pagina” și rezultatele ca rânduri-card: membrul (avatar, numele stilizat, grupul), mesajul (emoticoane, miniaturi care
 * deschid vizualizatorul, mențiuni ca pastile, „(editat)”, „ASCUNS”), data, chip-ul „#ID” (copiază linkul) și, la
 * hover, acțiunile (ascunde / șterge pentru staff, „Vezi în chat”). Cere aplicația Chat Pro și `chat_pro.history`.
 */
export default async function ChatHistoryPage({ searchParams }: { searchParams: Promise<Search> }) {
  const actor = await currentActor();
  if (!actor.userId) redirect("/login");
  const { chatPro } = services();
  if (!(await chatPro.canUse(actor))) notFound();
  const [t, tm, format] = await Promise.all([getTranslations("chatPro.historyPage"), getTranslations("chat.mod"), getFormatter()]);
  if (!(await chatPro.history.canView(actor))) {
    return (
      <GcsCard style={{ padding: 24 }} role="alert" data-testid="gcs-chat-history-forbidden">
        <GcsIcon name="fa-solid fa-lock" className="gcs-emptyIcon" />
        {t("forbidden")}
      </GcsCard>
    );
  }
  const sp = await searchParams;
  const data = await chatPro.history.page(actor, {
    q: sp.q ?? "",
    member: sp.member ?? "",
    from: sp.from ?? "",
    to: sp.to ?? "",
    ...(sp.channel ? { channel: sp.channel } : {}),
    page: Number(sp.page ?? "1") || 1,
    hidden: sp.hidden === "1",
  });
  const when = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "short", timeStyle: "short" });
  /** Linkul paginii cu filtrele curente, schimbate de `patch` (`null` = scos). */
  const href = (patch: Partial<Record<(typeof FILTER_KEYS)[number] | "page", string | null>> = {}) => {
    const params = new URLSearchParams();
    for (const k of FILTER_KEYS) {
      const v = k in patch ? patch[k] : sp[k];
      if (typeof v === "string" && v !== "") params.set(k, v);
    }
    if (patch.page && patch.page !== "1") params.set("page", patch.page);
    const qs = params.toString();
    return qs ? `/chat/history?${qs}` : "/chat/history";
  };
  const base = href({ page: null });
  const exportHref = `/api/chat-pro/history/export${base.includes("?") ? base.slice(base.indexOf("?")) : ""}`;
  const start = Math.max(1, Math.min(data.page - 2, data.pages - 5));
  const numbers = Array.from({ length: Math.min(6, data.pages - start + 1) }, (_, i) => start + i);

  const stat = (value: number, label: string, testId: string) => (
    <div className="gcs-chHist__stat" data-testid={testId}>
      <i aria-hidden="true" />
      <b>{format.number(value)}</b>
      <span>{label}</span>
    </div>
  );
  const field = (label: string, icon: string, input: ReactNode) => (
    <label className="gcs-chHist__fieldWrap">
      <span className="gcs-chHist__label">{label}</span>
      <span className="gcs-chHist__field">
        <span className="gcs-chHist__pre" aria-hidden="true">
          <GcsIcon name={icon} />
        </span>
        {input}
      </span>
    </label>
  );
  // Linkurile externe (nofollow după ACP → SEO), apoi numele membrilor.
  const rows = await Promise.all(data.rows.map(async (r) => ({ ...r, html: await namesHtml(await userContentHtml(r.html)) })));

  return (
    <div className="gcs-chHist gcs-chatHistory" data-testid="gcs-chat-history">
      <header className="gcs-chHist__box gcs-chHist__head">
        <span className="gcs-chHist__icon" aria-hidden="true">
          <GcsIcon name="fa-solid fa-clock-rotate-left" />
        </span>
        <h1 className="gcs-chHist__title">{t("title")}</h1>
        <Link href="/chat" className="gcs-chHist__back gcs-sweep">
          <GcsIcon name="fa-solid fa-arrow-left" />
          {t("back")}
        </Link>
      </header>

      <div className="gcs-chHist__stats">
        {stat(data.totals.messages, t("totalMessages"), "gcs-chat-history-messages")}
        {stat(data.totals.users, t("totalUsers"), "gcs-chat-history-users")}
        {stat(data.totals.edited, t("totalEdited"), "gcs-chat-history-edited")}
      </div>

      <section className="gcs-chHist__box gcs-chHist__search">
        <form className="gcs-chHist__form" method="get" action="/chat/history" role="search" aria-label={t("search")}>
          {sp.channel && <input type="hidden" name="channel" value={sp.channel} />}
          {sp.hidden === "1" && <input type="hidden" name="hidden" value="1" />}
          {field(t("text"), "fa-solid fa-magnifying-glass", <input className="gcs-chHist__in" type="search" name="q" defaultValue={sp.q ?? ""} maxLength={100} placeholder={t("textPlaceholder")} data-testid="gcs-chat-history-q" />)}
          {field(t("member"), "fa-solid fa-user", <input className="gcs-chHist__in" name="member" defaultValue={sp.member ?? ""} maxLength={40} placeholder={t("memberPlaceholder")} data-testid="gcs-chat-history-member" />)}
          {field(t("from"), "fa-regular fa-calendar", <input className="gcs-chHist__in" type="date" name="from" defaultValue={sp.from ?? ""} />)}
          {field(t("to"), "fa-regular fa-calendar", <input className="gcs-chHist__in" type="date" name="to" defaultValue={sp.to ?? ""} />)}
          <button type="submit" className="gcs-chHist__btn gcs-sweep" data-testid="gcs-chat-history-submit">
            <GcsIcon name="fa-solid fa-magnifying-glass" />
            {t("submit")}
          </button>
        </form>
        <div className="gcs-chHist__chips">
          <span className="gcs-chHist__label">{t("room")}</span>
          <Link href={href({ channel: null, page: null })} className={`gcs-chHist__chip gcs-sweep${!sp.channel ? " gcs-chHist__chip--on" : ""}`} aria-current={!sp.channel ? "true" : undefined}>
            {t("allRooms")}
          </Link>
          {data.channels.map((c) => (
            <Link key={c.key} href={href({ channel: c.key, page: null })} className={`gcs-chHist__chip gcs-sweep${sp.channel === c.key ? " gcs-chHist__chip--on" : ""}`} aria-current={sp.channel === c.key ? "true" : undefined} data-testid={`gcs-chat-history-room-${c.key}`}>
              {c.name}
            </Link>
          ))}
          {(data.can.hidden || data.can.export) && (
            <>
              <span className="gcs-chHist__spacer" />
              <span className="gcs-chHist__label">{t("staff")}</span>
              {data.can.hidden && (
                <Link href={href({ hidden: sp.hidden === "1" ? null : "1", page: null })} className={`gcs-chHist__chip gcs-sweep${sp.hidden === "1" ? " gcs-chHist__chip--on" : ""}`} data-testid="gcs-chat-history-hidden">
                  {t("showHidden")}
                </Link>
              )}
              {data.can.export && (
                <a href={exportHref} className="gcs-chHist__chip gcs-sweep" download data-testid="gcs-chat-history-export">
                  <GcsIcon name="fa-solid fa-file-csv" /> {t("export")}
                </a>
              )}
            </>
          )}
        </div>
      </section>

      <nav className="gcs-chHist__pag" aria-label={t("pages")}>
        {data.pages > 1 && (
          <>
            {numbers.map((n) =>
              n === data.page ? (
                <span key={n} className="gcs-chHist__pg gcs-chHist__pg--on" aria-current="page">
                  {n}
                </span>
              ) : (
                <Link key={n} href={href({ page: String(n) })} className="gcs-chHist__pg gcs-sweep">
                  {n}
                </Link>
              ),
            )}
            {data.page < data.pages && (
              <>
                <Link href={href({ page: String(data.page + 1) })} className="gcs-chHist__pg gcs-sweep" rel="next" data-testid="gcs-chat-history-next">
                  {t("next")}
                </Link>
                <Link href={href({ page: String(data.pages) })} className="gcs-chHist__pg gcs-sweep" title={t("last")} aria-label={t("last")}>
                  »
                </Link>
              </>
            )}
            <GcsHistoryJump page={data.page} pages={data.pages} base={base} />
          </>
        )}
        <span className="gcs-chHist__spacer" />
        <span className="gcs-chHist__count" data-testid="gcs-chat-history-found">
          {t("perPage", { count: data.total, size: 25 })}
        </span>
      </nav>

      <section className="gcs-chHist__well" aria-label={t("title")} data-gcs-gallery="history">
        <div className="gcs-chHist__cols" aria-hidden="true">
          <span>{t("colMember")}</span>
          <span>{t("colContent")}</span>
          <span>{t("colTimeId")}</span>
        </div>
        {rows.length === 0 && <p className="gcs-chHist__empty">{t("empty")}</p>}
        {rows.map((r) => {
          const link = `/chat?c=${encodeURIComponent(r.channel.key)}&m=${r.id}`;
          const images = [...r.files.filter((f) => f.kind === "image").map((f) => ({ src: `/files/${f.id}`, gif: false })), ...r.embeds.filter((e) => e.kind === "image").map((e) => ({ src: e.kind === "image" ? e.url : "", gif: /\.gif(?:$|\?)/i.test(e.kind === "image" ? e.url : "") }))];
          const voice = r.files.some((f) => f.kind === "audio");
          return (
            <article
              key={r.id}
              className={`gcs-chHist__card${r.hidden ? " gcs-chHist__card--hidden" : ""}`}
              data-testid="gcs-chat-history-row"
              data-gcs-caption-author={r.author?.name ?? t("deletedMember")}
              data-gcs-caption-date={r.createdAt}
              data-gcs-caption-href={link}
            >
              <div className="gcs-chHist__who">
                {r.author ? (
                  <>
                    <a href={memberHref(r.author)} className="gcs-chHist__av" tabIndex={-1} aria-hidden="true">
                      <GcsAvatar name={r.author.name} userId={r.author.id} src={r.author.image ?? undefined} size="m" />
                    </a>
                    <span className="gcs-chHist__whoText">
                      <GcsMemberName userId={r.author.id} name={r.author.name} nameKey={r.author.nameKey} href={memberHref(r.author)} className="gcs-chHist__name" />
                      {r.group && (
                        <Link href={`/members?group=${r.group.id}`} className="gcs-chHist__group" style={r.group.color ? { color: r.group.color } : undefined}>
                          {r.group.icon && <GcsIcon name={r.group.icon} />}
                          {r.group.name}
                        </Link>
                      )}
                    </span>
                  </>
                ) : (
                  <span className="gcs-deletedMember">{t("deletedMember")}</span>
                )}
              </div>
              <div className="gcs-chHist__msg">
                {r.system ? (
                  <GcsHistorySystem system={r.system} author={r.author} deletedMember={t("deletedMember")} />
                ) : (
                  // HTML-ul produs de server din text (escapat; linkurile http(s), pastilele mențiunilor și emoticoanele).
                  r.html && <span className="gcs-chHist__text" dangerouslySetInnerHTML={{ __html: r.html }} />
                )}
                {images.map((img) => (
                  <button key={img.src} type="button" className="gcs-chHist__thumb gcs-sweep" data-gcs-viewer={img.src} aria-label={t("openImage")}>
                    <img src={img.src} alt="" loading="lazy" referrerPolicy="no-referrer" />
                    {img.gif && <span>GIF</span>}
                  </button>
                ))}
                {voice && (
                  <span className="gcs-chHist__voice">
                    <GcsIcon name="fa-solid fa-microphone" /> {t("voice")}
                  </span>
                )}
                {r.hidden && (
                  <span className="gcs-chatHiddenTag" title={r.hidden.by ? tm("hiddenBy", { name: r.hidden.by.name }) : undefined} data-testid="gcs-chat-history-hidden-tag">
                    {tm("hiddenTag")}
                  </span>
                )}
                {r.editedAt && (
                  <span className="gcs-chHist__edited" title={when(r.editedAt)}>
                    ({t("edited")})
                  </span>
                )}
              </div>
              <div className="gcs-chHist__time">
                <GcsHistoryActions id={r.id} hidden={r.hidden !== null} canHide={data.can.hide} canDelete={data.can.delete} href={link} />
                <time className="gcs-chHist__date" dateTime={r.createdAt}>
                  {when(r.createdAt)}
                </time>
                <GcsHistoryIdChip id={r.id} href={link} />
              </div>
            </article>
          );
        })}
      </section>
    </div>
  );
}
