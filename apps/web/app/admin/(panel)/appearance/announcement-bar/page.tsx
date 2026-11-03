import { ANNOUNCEMENT_ACP_SECTION, ANNOUNCEMENT_MAX_BARS } from "@gcs/modules";
import { iconMatch, type GcsIconMatch } from "@gcs/ui/icon-registry";
import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { GCS_LOCALES } from "@/i18n";
import { requireAcpSection } from "@/lib/acp";
import { currentActor } from "@/lib/actor";
import { announcementConfig, announcementStats, siteTimeZone } from "@/lib/announcement";
import { services } from "@/lib/services";
import { GcsAcpTitle } from "../../_components/GcsAcpTitle";
import { GcsAnnouncementEditor, GcsAnnouncementTitleActions } from "./GcsAnnouncementEditor";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.announcementBar"))("title") };
}

/** Numele fusului orar în limba ACP-ului (ex. „Ora standard a Europei de Est”); fusul invalid → id-ul lui. */
function zoneName(timeZone: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: "longGeneric" }).formatToParts(new Date()).find((p) => p.type === "timeZoneName")?.value ?? timeZone;
  } catch {
    return timeZone;
  }
}

/**
 * ACP → Aspect → Conținut → Bară de anunț (v2): lista barelor cu starea și cifrele lor, panoul cu previzualizarea live
 * și secțiunile Conținut, Aspect, Poziție, Cine o vede, Program, Comportament; setările generale (rotația, ordinea,
 * statisticile) în panoul din titlu. Programul se socotește în fusul site-ului.
 */
export default async function AcpAnnouncementBarPage() {
  await requireAcpSection(ANNOUNCEMENT_ACP_SECTION);
  const [t, locale, config, groups, timeZone, actor] = await Promise.all([
    getTranslations("acp.announcementBar"),
    getLocale(),
    announcementConfig(),
    services().db.group.findMany({ where: { key: { not: "guest" } }, orderBy: { position: "asc" }, select: { id: true, name: true, color: true } }),
    siteTimeZone(),
    currentActor(),
  ]);
  const [stats, me] = await Promise.all([
    announcementStats(config.bars.map((b) => b.id)),
    actor.userId ? services().db.user.findUnique({ where: { id: actor.userId }, select: { name: true } }) : null,
  ]);
  const icons: Record<string, GcsIconMatch> = {};
  for (const b of config.bars) {
    const icon = b.icon ? iconMatch(b.icon) : null;
    if (b.icon && icon) icons[b.icon] = icon;
  }
  const names = new Intl.DisplayNames([locale], { type: "language" });
  const locales = GCS_LOCALES.map((code) => ({ code, name: names.of(code) ?? code }));
  return (
    <GcsAnnouncementEditor
      title={
        <GcsAcpTitle icon="fa-solid fa-bullhorn" description={t("intro")} actions={<GcsAnnouncementTitleActions />}>
          {t("title")}
        </GcsAcpTitle>
      }
      initial={config}
      stats={stats}
      groups={groups}
      locales={locales}
      icons={icons}
      timeZone={timeZone}
      zoneLabel={zoneName(timeZone, locale)}
      sampleName={me?.name ?? "Ștefan"}
      maxBars={ANNOUNCEMENT_MAX_BARS}
    />
  );
}
