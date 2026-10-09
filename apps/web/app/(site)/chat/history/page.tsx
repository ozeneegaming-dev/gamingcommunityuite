import { GcsCard, GcsUserLink } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { currentActor } from "@/lib/actor";
import { memberHref } from "@/lib/forum-urls";
import { services } from "@/lib/services";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("chatPro.historyPage"))("title"), robots: { index: false } };
}

type Search = { q?: string; member?: string; from?: string; to?: string; channel?: string; page?: string };

/**
 * `/chat/history` (Chat Pro): totalurile (mesaje, membri, mesaje editate), căutarea după text, membru (nume sau
 * poreclă) și interval de zile, tabelul paginat (membrul, mesajul, ora, numărul mesajului, ora editării). Doar mesajele
 * camerelor pe care viewer-ul le poate citi; cere aplicația Chat Pro și permisiunea `chat_pro.history`.
 */
export default async function ChatHistoryPage({ searchParams }: { searchParams: Promise<Search> }) {
  const actor = await currentActor();
  if (!actor.userId) redirect("/login");
  const { chatPro } = services();
  if (!(await chatPro.canUse(actor))) notFound();
  const [t, format] = await Promise.all([getTranslations("chatPro.historyPage"), getFormatter()]);
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
  });
  const when = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium", timeStyle: "short" });
  const pageHref = (page: number) => {
    const params = new URLSearchParams(Object.entries(sp).filter(([k, v]) => k !== "page" && typeof v === "string" && v !== "") as [string, string][]);
    if (page > 1) params.set("page", String(page));
    const qs = params.toString();
    return qs ? `/chat/history?${qs}` : "/chat/history";
  };
  const total = (icon: string, value: number, label: string, testId: string) => (
    <GcsCard className="gcs-chatHistory__total" data-testid={testId}>
      <span className="gcs-chatHistory__totalIcon" aria-hidden="true">
        <GcsIcon name={icon} />
      </span>
      <span>
        <strong>{format.number(value)}</strong>
        <span>{label}</span>
      </span>
    </GcsCard>
  );

  return (
    <div className="gcs-chatHistory" data-testid="gcs-chat-history">
      <header className="gcs-pageHeader">
        <h1 className="gcs-display gcs-pageHeader__title">
          <GcsIcon name="fa-solid fa-clock-rotate-left" className="gcs-bandIcon" />
          {t("title")}
        </h1>
        <Link href="/chat" className="gcs-btn gcs-btn--ghost gcs-btn--sm">
          {t("back")}
        </Link>
      </header>
      <div className="gcs-chatHistory__totals">
        {total("fa-solid fa-comments", data.totals.messages, t("totalMessages"), "gcs-chat-history-messages")}
        {total("fa-solid fa-users", data.totals.users, t("totalUsers"), "gcs-chat-history-users")}
        {total("fa-solid fa-pen", data.totals.edited, t("totalEdited"), "gcs-chat-history-edited")}
      </div>
      <form className="gcs-card gcs-chatHistory__filters" method="get" action="/chat/history" role="search" aria-label={t("search")}>
        <label className="gcs-field">
          {t("text")}
          <input className="gcs-input" type="search" name="q" defaultValue={sp.q ?? ""} maxLength={100} data-testid="gcs-chat-history-q" />
        </label>
        <label className="gcs-field">
          {t("member")}
          <input className="gcs-input" name="member" defaultValue={sp.member ?? ""} maxLength={40} data-testid="gcs-chat-history-member" />
        </label>
        <label className="gcs-field">
          {t("from")}
          <input className="gcs-input" type="date" name="from" defaultValue={sp.from ?? ""} />
        </label>
        <label className="gcs-field">
          {t("to")}
          <input className="gcs-input" type="date" name="to" defaultValue={sp.to ?? ""} />
        </label>
        <button type="submit" className="gcs-btn gcs-btn--primary" data-testid="gcs-chat-history-submit">
          {t("submit")}
        </button>
      </form>
      <GcsCard style={{ padding: 0, overflow: "hidden" }}>
        <p className="gcs-muted" style={{ margin: 0, padding: "10px 12px", fontSize: 13 }} data-testid="gcs-chat-history-found">
          {t("found", { count: data.total })}
        </p>
        {data.rows.length === 0 ? (
          <p className="gcs-muted" style={{ margin: 0, padding: "0 12px 14px" }}>
            {t("empty")}
          </p>
        ) : (
          <table className="gcs-chatHistory__table">
            <caption className="gcs-srOnly">{t("title")}</caption>
            <thead>
              <tr>
                <th scope="col">{t("colMember")}</th>
                <th scope="col">{t("colContent")}</th>
                <th scope="col">{t("colTime")}</th>
                <th scope="col">{t("colNumber")}</th>
                <th scope="col">{t("colEdited")}</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.id} data-testid="gcs-chat-history-row">
                  <td>{r.author ? <GcsUserLink userId={r.author.id} name={r.author.name} nameKey={r.author.nameKey} href={memberHref(r.author)} /> : <span className="gcs-deletedMember">{t("deletedMember")}</span>}</td>
                  {/* HTML-ul produs de server din text (escapat; doar linkurile http(s) devin <a>). */}
                  <td className="gcs-chatHistory__content" dangerouslySetInnerHTML={{ __html: r.html }} />
                  <td className="gcs-chatHistory__num">
                    <time dateTime={r.createdAt}>{when(r.createdAt)}</time>
                  </td>
                  <td className="gcs-chatHistory__num">
                    <a href={`/chat?c=${r.channel.key}`} title={r.channel.name}>
                      #{r.id}
                    </a>
                  </td>
                  <td className="gcs-chatHistory__num">{r.editedAt ? <time dateTime={r.editedAt}>{when(r.editedAt)}</time> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </GcsCard>
      {data.pages > 1 && (
        <nav className="gcs-chatHistory__pager" aria-label={t("pages")}>
          {data.page > 1 && (
            <Link href={pageHref(data.page - 1)} className="gcs-btn gcs-btn--ghost gcs-btn--sm" rel="prev">
              {t("prev")}
            </Link>
          )}
          <span className="gcs-muted">{t("page", { page: data.page, pages: data.pages })}</span>
          {data.page < data.pages && (
            <Link href={pageHref(data.page + 1)} className="gcs-btn gcs-btn--ghost gcs-btn--sm" rel="next" data-testid="gcs-chat-history-next">
              {t("next")}
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}
