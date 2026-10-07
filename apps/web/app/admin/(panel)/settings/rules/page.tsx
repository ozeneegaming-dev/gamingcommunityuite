import { COMMUNITY_RULES_SETTING, isCommunityRules, COMMUNITY_RULES_ACP_SECTION, RULES_HREF } from "@gcs/modules";
import { GcsCard } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { JSONContent } from "@tiptap/core";
import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { services } from "@/lib/services";
import { GcsAcpTitle } from "../../_components/GcsAcpTitle";
import { GcsRulesEditor } from "./GcsRulesEditor";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.rules"))("title") };
}

/**
 * ACP → Setări → Reguli comunitate: regulile din pagina `/rules`, scrise cu editorul postărilor. Cât timp sunt goale,
 * itemul „Reguli” lipsește din meniul site-ului.
 */
export default async function AcpRulesPage() {
  await requireAcpSection(COMMUNITY_RULES_ACP_SECTION);
  const [t, format, raw] = await Promise.all([getTranslations("acp.rules"), getFormatter(), services().settings.get<unknown>(COMMUNITY_RULES_SETTING)]);
  const rules = isCommunityRules(raw) ? raw : null;
  return (
    <>
      <GcsAcpTitle icon="fa-solid fa-scale-balanced">{t("title")}</GcsAcpTitle>
      <GcsCard as="section" style={{ padding: 20, maxWidth: 900, display: "flex", flexDirection: "column", gap: 12 }}>
        <p style={{ margin: 0, color: "var(--gcs-muted)", fontSize: 14 }}>{t("hint")}</p>
        <p style={{ margin: 0, fontSize: 14 }} data-testid="gcs-rules-state">
          {rules ? t("updated", { date: format.dateTime(new Date(rules.updatedAt), { dateStyle: "long", timeStyle: "short" }) }) : t("empty")}{" "}
          <Link href={RULES_HREF} target="_blank" rel="noopener">
            <GcsIcon name="fa-solid fa-arrow-up-right-from-square" className="gcs-hIcon" />
            {t("view")}
          </Link>
        </p>
        <GcsRulesEditor
          initial={(rules?.doc as JSONContent | undefined) ?? null}
          labels={{ save: t("save"), clear: t("clear"), saved: t("saved"), cleared: t("cleared"), confirmClear: t("confirmClear") }}
        />
      </GcsCard>
    </>
  );
}
