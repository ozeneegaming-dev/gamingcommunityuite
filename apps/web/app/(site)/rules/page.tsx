import { sanitizeContentHtml } from "@gcs/core";
import { communityRules, COMMUNITY_RULES_ACP_SECTION } from "@gcs/modules";
import { GcsButton, GcsCard } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { currentActor } from "@/lib/actor";
import { services } from "@/lib/services";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("rules"))("title") };
}

/**
 * `/rules`: regulile comunității, scrise în ACP cu editorul postărilor și randate de același randator și sanitizer ca
 * postările. Fără reguli: o stare goală, cu linkul spre ACP pentru cine le poate scrie.
 */
export default async function RulesPage() {
  const { settings, acp } = services();
  const [t, format, actor, rules] = await Promise.all([getTranslations("rules"), getFormatter(), currentActor(), communityRules(settings)]);

  if (!rules) {
    const canEdit = actor.userId !== null && (await acp.can(actor, COMMUNITY_RULES_ACP_SECTION, "edit"));
    return (
      <GcsCard as="section" className="gcs-rules" aria-labelledby="gcs-rules-title" data-testid="gcs-rules-empty">
        <h1 id="gcs-rules-title" className="gcs-display gcs-pageHeader__title">
          <GcsIcon name="fa-solid fa-scale-balanced" className="gcs-hIcon" />
          {t("title")}
        </h1>
        <p className="gcs-muted" style={{ margin: 0, fontSize: 15 }}>
          <GcsIcon name="fa-regular fa-file-lines" className="gcs-emptyIcon" />
          {t("empty")}
        </p>
        {canEdit && (
          <div>
            <GcsButton variant="primary" asChild icon={<GcsIcon name="fa-solid fa-pen" />}>
              <Link href="/admin/settings/rules">{t("write")}</Link>
            </GcsButton>
          </div>
        )}
      </GcsCard>
    );
  }

  return (
    <GcsCard as="article" className="gcs-rules" aria-labelledby="gcs-rules-title" data-testid="gcs-rules">
      <header className="gcs-rules__head">
        <h1 id="gcs-rules-title" className="gcs-display gcs-pageHeader__title">
          <GcsIcon name="fa-solid fa-scale-balanced" className="gcs-hIcon" />
          {t("title")}
        </h1>
        <p className="gcs-muted" style={{ margin: 0, fontSize: 13 }}>
          <time dateTime={rules.updatedAt}>{t("updated", { date: format.dateTime(new Date(rules.updatedAt), { dateStyle: "long" }) })}</time>
        </p>
      </header>
      {/* Încă o trecere prin sanitizer: setarea se poate scrie și altfel decât prin editor (ex. o cerere ACP făcută de mână). */}
      <div className="gcs-postBody gcs-rules__body" dangerouslySetInnerHTML={{ __html: sanitizeContentHtml(rules.html) }} />
    </GcsCard>
  );
}
