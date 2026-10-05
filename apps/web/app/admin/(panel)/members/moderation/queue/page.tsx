import { GcsBadge, GcsCard, GcsUserLink } from "@gcs/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { postHref } from "@/lib/forum-urls";
import { services } from "@/lib/services";
import { GcsActionForm } from "../../../_components/GcsActionForm";
import { moderateQueue } from "../../../moderation-actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.queue"))("title") };
}

/** ACP → Membri → Moderare → Coadă unificată: postările și topicurile care așteaptă aprobare, din forumurile adminului. */
export default async function AcpQueuePage() {
  const panel = await requireAcpSection("members.queue");
  const t = await getTranslations("acp.queue");
  const format = await getFormatter();
  const { pending, reports } = await services().moderation.queue(panel.actor, { page: 1 });

  return (
    <>
      <h1 className="gcs-display" style={{ margin: 0, fontSize: 28, fontWeight: 700 }}>
        {t("title")}
      </h1>
      <p style={{ margin: 0 }}>
        <Link href="/admin/members/moderation/reports">{t("reportsLink", { count: reports.length })}</Link>
      </p>
      {pending.length === 0 ? (
        <GcsCard style={{ padding: 16 }}>
          <p className="gcs-muted" style={{ margin: 0 }}>
            {t("empty")}
          </p>
        </GcsCard>
      ) : (
        <>
          <GcsCard style={{ padding: 16 }}>
            <GcsActionForm action={moderateQueue} submitLabel={t("approveSelected")}>
              <input type="hidden" name="decision" value="approve" />
              {pending.map((p) => (
                <label key={p.postId} className="gcs-check">
                  <input type="checkbox" name="postId" value={p.postId} aria-label={t("select", { id: p.postId })} />
                  {p.topicTitle} · {p.author?.name ?? "—"}
                </label>
              ))}
            </GcsActionForm>
          </GcsCard>
          {pending.map((p) => (
            <GcsCard key={p.postId} as="article" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }} data-testid="gcs-queue-item">
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", fontSize: 13 }}>
                <GcsBadge tone={p.isTopic ? "warn" : "info"}>{p.isTopic ? t("topic") : t("reply")}</GcsBadge>
                <Link href={postHref(p.topicId, p.postId)}>{p.topicTitle}</Link>
                <span className="gcs-muted">{t("in", { forum: p.forumName })}</span>
                {p.author && <GcsUserLink userId={p.author.id} name={p.author.name} nameKey={p.author.nameKey} href={`/admin/members/${p.author.id}`} />}
                <span className="gcs-muted">{format.relativeTime(new Date(p.createdAt))}</span>
              </div>
              <div className="gcs-postBody" dangerouslySetInnerHTML={{ __html: p.html }} />
              <div style={{ display: "flex", gap: 8 }}>
                <GcsActionForm action={moderateQueue} submitLabel={t("approve")} compact>
                  <input type="hidden" name="postId" value={p.postId} />
                  <input type="hidden" name="decision" value="approve" />
                </GcsActionForm>
                <GcsActionForm action={moderateQueue} submitLabel={t("reject")} variant="ghost" compact>
                  <input type="hidden" name="postId" value={p.postId} />
                  <input type="hidden" name="decision" value="reject" />
                  <input type="hidden" name="reason" value={t("rejectReason")} />
                </GcsActionForm>
              </div>
            </GcsCard>
          ))}
        </>
      )}
    </>
  );
}
