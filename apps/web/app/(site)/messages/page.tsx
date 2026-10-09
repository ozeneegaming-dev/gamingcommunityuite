import { GcsAvatar, GcsButton, GcsCard } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { currentActor } from "@/lib/actor";
import { pageParam } from "@/lib/forum-page";
import { services } from "@/lib/services";
import { GcsMemberLink } from "@/lib/member-names";
import { Fragment } from "react";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("messages"))("title"), robots: { index: false } };
}

/** Inbox-ul (specul etapei 3, §8): conversațiile, cele necitite marcate. */
export default async function InboxPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const actor = await currentActor();
  if (!actor.userId) redirect("/login");
  const page = pageParam((await searchParams).page);
  const t = await getTranslations("messages");
  const tp = await getTranslations("forum.pagination");
  const format = await getFormatter();
  const inbox = await services().conversationQueries.inbox(actor, page);

  return (
    <>
      <header className="gcs-pageHeader gcs-pageHeader--center">
        <h1 className="gcs-display gcs-pageHeader__title">
          <GcsIcon name="fa-solid fa-envelope" className="gcs-hIcon" />
          {t("title")}
        </h1>
        <GcsButton variant="primary" asChild icon={<GcsIcon name="fa-solid fa-pen" />}>
          <Link href="/messages/new">{t("new")}</Link>
        </GcsButton>
      </header>
      <GcsCard as="section" style={{ overflow: "hidden" }}>
        {inbox.items.length === 0 && (
          <p className="gcs-muted" style={{ padding: "20px 24px", margin: 0 }}>
            <GcsIcon name="fa-regular fa-envelope-open" className="gcs-emptyIcon" />
            {t("empty")}
          </p>
        )}
        <ul className="gcs-inbox" data-testid="gcs-inbox">
          {inbox.items.map((c) => {
            const others = c.participants.filter((p) => p.id !== actor.userId);
            const first = others[0] ?? c.participants[0];
            return (
              <li key={c.id} className={`gcs-inbox__item${c.unread ? " gcs-inbox__item--unread" : ""}`} data-testid="gcs-inbox-item">
                {first && <GcsAvatar name={first.name} size="m" {...(first.image ? { src: first.image } : {})} {...(first.frameKey ? { frame: first.frameKey } : {})} />}
                <div className="gcs-inbox__main">
                  <Link href={`/messages/${c.id}`} className="gcs-inbox__title">
                    {c.unread && <span className="gcs-dot gcs-dot--unread" aria-label={t("unread")} />} {c.title}
                  </Link>
                  <span className="gcs-muted" style={{ fontSize: 13 }}>
                    {others.length > 0
                      ? others.map((p, i) => (
                          <Fragment key={p.id}>
                            {i > 0 && ", "}
                            <GcsMemberLink user={p} />
                          </Fragment>
                        ))
                      : t("onlyYou")}
                  </span>
                  {c.last && (
                    <span className="gcs-inbox__snippet">
                      {c.last.author ? (
                        <>
                          <GcsMemberLink user={c.last.author} href={null} />
                          {": "}
                        </>
                      ) : (
                        ""
                      )}
                      {c.last.snippet}
                    </span>
                  )}
                </div>
                <span className="gcs-muted" style={{ fontSize: 12, whiteSpace: "nowrap" }}>
                  {format.relativeTime(new Date(c.lastMessageAt))}
                </span>
              </li>
            );
          })}
        </ul>
      </GcsCard>
      {inbox.pages > 1 && (
        <nav aria-label={t("pages")} style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {page > 1 && (
            <Link href={`/messages?page=${page - 1}`} aria-label={tp("prev")} title={tp("prev")}>
              <GcsIcon name="fa-solid fa-chevron-left" />
            </Link>
          )}
          <span>
            {page} / {inbox.pages}
          </span>
          {page < inbox.pages && (
            <Link href={`/messages?page=${page + 1}`} aria-label={tp("next")} title={tp("next")}>
              <GcsIcon name="fa-solid fa-chevron-right" />
            </Link>
          )}
        </nav>
      )}
    </>
  );
}
