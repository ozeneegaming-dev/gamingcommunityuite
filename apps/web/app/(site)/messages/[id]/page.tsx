import { GcsNotFound } from "@gcs/core";
import { GcsAvatar, GcsCard, GcsUserLink } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { currentActor } from "@/lib/actor";
import { memberHref } from "@/lib/forum-urls";
import { pageParam } from "@/lib/forum-page";
import { services } from "@/lib/services";
import { translateLabels } from "@/lib/translate";
import { GcsTranslateButton } from "../../_components/GcsTranslateButton";
import { GcsConversationReply, GcsConversationTools, GcsRefreshAfterRead, GcsReportMessageButton } from "../../_components/messages/GcsMessageForms";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ page?: string }> };

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("messages"))("title"), robots: { index: false } };
}

/** O conversație: mesajele, „citit de”, participanții, invitarea și părăsirea (specul etapei 3, §8). */
export default async function ConversationPage({ params, searchParams }: Props) {
  const actor = await currentActor();
  if (!actor.userId) redirect("/login");
  const id = Number((await params).id);
  if (!Number.isSafeInteger(id) || id <= 0) notFound();
  const query = await searchParams;
  const { conversationQueries, conversations } = services();
  const view = await conversationQueries.conversation(actor, id, query.page ? pageParam(query.page) : undefined).catch((error: unknown) => {
    if (error instanceof GcsNotFound) notFound();
    throw error;
  });
  const lastShown = view.messages[view.messages.length - 1];
  const wasUnread = view.firstUnreadId !== null;
  if (lastShown) await conversations.markRead(actor, id, lastShown.id);

  const t = await getTranslations("messages");
  const format = await getFormatter();
  const translate = await translateLabels(actor);
  return (
    <>
      <GcsRefreshAfterRead wasUnread={wasUnread} />
      <header className="gcs-pageHeader">
        <div className="gcs-pageHeader__text gcs-pageHeader__text--tight">
          <Link href="/messages" className="gcs-pageHeader__back">
            <GcsIcon name="fa-solid fa-arrow-left" className="gcs-hIcon" />
            {t("title")}
          </Link>
          <h1 className="gcs-display gcs-pageHeader__title" style={{ fontSize: 28 }} data-testid="gcs-conversation-title">
            {view.title}
          </h1>
        </div>
      </header>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 20, alignItems: "flex-start" }}>
        <div style={{ flex: "999 1 640px", minWidth: 0, display: "flex", flexDirection: "column", gap: 14 }}>
          {view.pages > 1 && (
            <nav aria-label={t("pages")} style={{ display: "flex", gap: 10 }}>
              {Array.from({ length: view.pages }, (_, i) => i + 1).map((p) => (
                <Link key={p} href={`/messages/${id}?page=${p}`} aria-current={p === view.page ? "page" : undefined}>
                  {p}
                </Link>
              ))}
            </nav>
          )}
          {view.messages.map((m) => (
            <GcsCard as="article" key={m.id} id={`message-${m.id}`} className={`gcs-message${m.mine ? " gcs-message--mine" : ""}`} data-testid="gcs-message">
              <header className="gcs-message__head">
                {m.author ? (
                  <>
                    <GcsAvatar name={m.author.name} size="s" {...(m.author.image ? { src: m.author.image } : {})} {...(m.author.frameKey ? { frame: m.author.frameKey } : {})} />
                    <GcsUserLink userId={m.author.id} name={m.author.name} nameKey={m.author.nameKey} href={memberHref(m.author)} />
                  </>
                ) : (
                  <span className="gcs-muted">—</span>
                )}
                <time className="gcs-muted" dateTime={m.createdAt} style={{ fontSize: 12 }}>
                  {format.dateTime(new Date(m.createdAt), { dateStyle: "medium", timeStyle: "short" })}
                </time>
                {!m.mine && <GcsReportMessageButton messageId={m.id} labels={{ report: t("report"), reason: t("reportReason"), done: t("reported") }} />}
              </header>
              <div className="gcs-postBody" dangerouslySetInnerHTML={{ __html: m.html }} />
              {translate && !m.mine && <GcsTranslateButton contentType="pm.message" contentId={m.id} labels={translate} />}
              {m.attachments.length > 0 && (
                <ul className="gcs-attachments">
                  {m.attachments.map((a) => (
                    <li key={a.id}>
                      <a href={`/files/${a.id}`}>
                        <GcsIcon name="fa-solid fa-paperclip" className="gcs-hIcon" />
                        {a.filename}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </GcsCard>
          ))}
          {view.readBy.length > 0 && (
            <p className="gcs-muted" style={{ margin: 0, fontSize: 13 }} data-testid="gcs-read-by">
              <GcsIcon name="fa-solid fa-check-double" className="gcs-hIcon" />
              {t("readBy", { names: view.readBy.map((u) => u.name).join(", ") })}
            </p>
          )}
          <GcsConversationReply conversationId={id} labels={{ send: t("send"), sending: t("sending"), reply: t("reply") }} />
        </div>
        <aside style={{ flex: "1 1 280px", minWidth: 0 }}>
          <GcsCard as="section" className="gcs-titledBox" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <h2 className="gcs-display gcs-titleBand gcs-cardTitle">
              <GcsIcon name="fa-solid fa-user-group" className="gcs-hIcon" />
              {t("participants", { count: view.participants.length })}
            </h2>
            <ul className="gcs-userGrid" style={{ gridTemplateColumns: "1fr" }} data-testid="gcs-participants">
              {view.participants.map((p) => (
                <li key={p.id}>
                  <GcsAvatar name={p.name} size="s" {...(p.image ? { src: p.image } : {})} {...(p.frameKey ? { frame: p.frameKey } : {})} />
                  <GcsUserLink userId={p.id} name={p.name} nameKey={p.nameKey} href={memberHref(p)} />
                  {p.id === view.starterId && <span className="gcs-muted" style={{ fontSize: 12 }}>· {t("starter")}</span>}
                </li>
              ))}
            </ul>
            <GcsConversationTools
              conversationId={id}
              labels={{
                invite: t("invite"),
                inviteTo: t("inviteTo"),
                invitePlaceholder: t("toPlaceholder"),
                remove: t("remove"),
                leave: t("leave"),
                confirmLeave: t("confirmLeave"),
                invited: t("invited"),
              }}
            />
          </GcsCard>
        </aside>
      </div>
    </>
  );
}
