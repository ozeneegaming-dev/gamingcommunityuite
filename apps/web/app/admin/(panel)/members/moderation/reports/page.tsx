import { GcsCard } from "@gcs/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { postHref } from "@/lib/forum-urls";
import { services } from "@/lib/services";
import { GcsActionForm } from "../../../_components/GcsActionForm";
import { closeReport } from "../../../moderation-actions";
import { GcsAcpTitle } from "../../../_components/GcsAcpTitle";
import { GcsMemberLink, GcsNamedHtml } from "@/lib/member-names";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.reports"))("title") };
}

/** ACP → Membri → Moderare → Rapoarte: conținutul raportat, cu motivele; închidere sau ascundere + închidere. */
export default async function AcpReportsPage() {
  const panel = await requireAcpSection("members.reports");
  const t = await getTranslations("acp.reports");
  const format = await getFormatter();
  const { reports } = await services().moderation.queue(panel.actor, { page: 1 });

  return (
    <>
      <GcsAcpTitle icon="fa-solid fa-flag">
        {t("title")}
      </GcsAcpTitle>
      {reports.length === 0 ? (
        <GcsCard style={{ padding: 16 }}>
          <p className="gcs-muted" style={{ margin: 0 }}>
            {t("empty")}
          </p>
        </GcsCard>
      ) : (
        reports.map((r) => (
          <GcsCard key={r.contentId} as="article" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }} data-testid="gcs-report-item">
            <Link href={postHref(r.topicId, Number(r.contentId))}>
              {r.topicTitle} · {t("open")}
            </Link>
            <GcsNamedHtml className="gcs-postBody" html={r.html} />
            <div>
              <strong>{t("reasons")}</strong>
              <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                {r.reasons.map((reason) => (
                  <li key={reason.id}>
                    {reason.reason}{" "}
                    <span className="gcs-muted">
                      {reason.reporter ? t.rich("by", { name: () => <GcsMemberLink user={reason.reporter!} /> }) : ""} · {format.relativeTime(new Date(reason.createdAt))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <GcsActionForm action={closeReport.bind(null, r.reasons[0]!.id, "hide")} submitLabel={t("hide")} submitKind="hide" compact />
              {r.reasons.map((reason) => (
                <GcsActionForm key={reason.id} action={closeReport.bind(null, reason.id, "none")} submitLabel={t("close")} submitKind="close" variant="ghost" compact />
              ))}
            </div>
          </GcsCard>
        ))
      )}
    </>
  );
}
