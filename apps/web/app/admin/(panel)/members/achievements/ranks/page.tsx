import { faPlus } from "@fortawesome/free-solid-svg-icons";
import { normalizeCriteria, RANK_PRESETS, RANK_TIERS, RANKS_ACP_SECTION, rankEmblemArt } from "@gcs/modules";
import { GcsBadgeArt, GcsIconSvg } from "@gcs/ui";
import { badgeArtSrc } from "@gcs/ui/badge-art";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { services } from "@/lib/services";
import { GcsAcpEditPanel } from "../../../_components/GcsAcpEditPanel";
import { GcsActionForm } from "../../../_components/GcsActionForm";
import { GcsAcpTitle } from "../../../_components/GcsAcpTitle";
import { deleteRank, saveRankV2 } from "../actions";
import { GcsRankFields, type GcsRankFieldsProps, type GcsRankTierArt } from "./GcsRankFields";
import { GcsRankLadder, type GcsLadderCard } from "./GcsRankLadder";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.achievements"))("ranksTitle") };
}

/**
 * ACP → Membri → Realizări → Ranguri (ranguri moderne): scara de carduri cu embleme e singura listă (distribuția
 * membrilor, ordinea prin tragere sau săgeți, copia, exportul / importul, scările prestabilite); „Editează” pe un rând
 * și „Rang nou” deschid panoul rangului (pragurile cu „toate / oricare” și criteriile aplicațiilor, emblema cu
 * previzualizare, avantajele), cu „Șterge” jos.
 */
export default async function AcpRanksPage() {
  await requireAcpSection(RANKS_ACP_SECTION);
  const t = await getTranslations("acp.achievements");
  const tAll = await getTranslations();
  const { achievementAdmin, achievementRules, apps, db } = services();
  const [ranks, dist, on, groups, badges, styles] = await Promise.all([
    achievementAdmin.ranks(),
    achievementAdmin.rankDistribution(),
    apps.enabledFilter(),
    db.group.findMany({ where: { isProtected: false }, orderBy: [{ position: "asc" }, { id: "asc" }], select: { id: true, name: true } }),
    db.badge.findMany({ orderBy: [{ position: "asc" }, { id: "asc" }], select: { id: true, name: true } }),
    db.nameStyle.findMany({ orderBy: [{ position: "asc" }, { id: "asc" }], select: { id: true, name: true } }),
  ]);
  const label = (key: string) => (tAll.has(key as never) ? tAll(key as never) : key);
  // Metricile de rang: evenimentele „valoare” ale aplicațiilor (cele oprite apar marcate și nu contează).
  const metrics = achievementRules.registry
    .achievementEvents()
    .filter((e) => e.def.rankMetric && e.def.current)
    .map((e) => ({ key: e.def.key, label: label(e.def.labelKey), off: !on(e.module) }));
  const metricLabel = (k: string) => metrics.find((m) => m.key === k)?.label ?? k;
  const nameOf = (list: { id: number; name: string }[], id: number | null) => list.find((x) => x.id === id)?.name ?? null;
  const autoTier = (i: number) => RANK_TIERS[Math.min(RANK_TIERS.length - 1, i)]!;

  // Desenul implicit al fiecărei trepte, pentru previzualizarea live din panou (fără codul serverului în client).
  const tierArt: Record<string, GcsRankTierArt> = Object.fromEntries(
    RANK_TIERS.map((k) => {
      const a = rankEmblemArt({ name: "", icon: null, emblemTier: k, emblemShape: null, emblemIcon: null, color: null });
      return [k, { tier: a.artTier ?? "custom", shape: a.artShape ?? "shield", color: a.color }];
    }),
  );
  const shared: Omit<GcsRankFieldsProps, "rank" | "autoTier"> = { tiers: RANK_TIERS, tierArt, metrics, groups, badges, styles };

  const cards: GcsLadderCard[] = ranks.map((r, i) => {
    const parts = [
      r.minPoints !== null ? t("v2.thrPoints", { n: r.minPoints }) : null,
      r.minPosts !== null ? t("v2.thrPosts", { n: r.minPosts }) : null,
      r.minReputation !== null ? t("v2.thrRep", { n: r.minReputation }) : null,
      ...normalizeCriteria(r.criteria).map((c) => `${metricLabel(c.metric)} ≥ ${c.min}`),
    ].filter((x): x is string => x !== null);
    const art = badgeArtSrc(rankEmblemArt(r, i));
    const image = r.imageAttachmentId ? `/files/${r.imageAttachmentId}` : null;
    return {
      id: r.id,
      name: r.name,
      art,
      image,
      tier: r.emblemTier ?? autoTier(i),
      animated: r.animated,
      members: dist.get(r.id) ?? 0,
      summary: parts.join(r.match === "any" ? ` ${t("v2.or")} ` : " · "),
      perks: [nameOf(groups, r.perkGroupId), nameOf(badges, r.perkBadgeId), nameOf(styles, r.perkNameStyleId)].filter((x): x is string => x !== null),
      edit: (
        <GcsAcpEditPanel
          title={r.name}
          titleIcon={<GcsBadgeArt badge={{ name: r.name, art, image }} size={24} decorative />}
          size="lg"
          testId="gcs-rank-edit"
          footer={
            <GcsActionForm action={deleteRank.bind(null, r.id)} submitLabel={t("delete")} submitKind="delete" variant="ghost" compact confirm={t("confirmDelete")}>
              {null}
            </GcsActionForm>
          }
        >
          <GcsActionForm action={saveRankV2.bind(null, r.id)} submitLabel={t("save")} submitKind="save">
            <GcsRankFields
              {...shared}
              autoTier={autoTier(i)}
              rank={{
                name: r.name,
                icon: r.icon,
                minPosts: r.minPosts,
                minPoints: r.minPoints,
                minReputation: r.minReputation,
                match: r.match,
                criteria: normalizeCriteria(r.criteria),
                emblemTier: r.emblemTier,
                emblemShape: r.emblemShape,
                emblemIcon: r.emblemIcon,
                color: r.color,
                animated: r.animated,
                image,
                perkGroupId: r.perkGroupId,
                perkBadgeId: r.perkBadgeId,
                perkNameStyleId: r.perkNameStyleId,
              }}
            />
          </GcsActionForm>
        </GcsAcpEditPanel>
      ),
    };
  });

  const addButton = (
    <GcsAcpEditPanel label={t("addRank")} variant="primary" buttonIcon={<GcsIconSvg icon={faPlus} />} title={t("addRank")} titleIcon={<GcsIconSvg icon={faPlus} />} size="lg" testId="gcs-rank-new">
      <GcsActionForm action={saveRankV2.bind(null, null)} submitLabel={t("add")} submitKind="create">
        <GcsRankFields {...shared} autoTier={autoTier(ranks.length)} rank={null} />
      </GcsActionForm>
    </GcsAcpEditPanel>
  );

  return (
    <>
      <GcsAcpTitle icon="fa-solid fa-ranking-star" description={t("v2.ranksHelp")}>
        {t("ranksTitle")}
      </GcsAcpTitle>
      <GcsRankLadder
        key={ranks.map((r) => `${r.id}:${r.name}:${dist.get(r.id) ?? 0}`).join(",")}
        ranks={cards}
        unranked={dist.get(null) ?? 0}
        presets={RANK_PRESETS.map((p) => ({ key: p.key, label: t(`v2.preset.${p.key as "gaming"}`) }))}
        addButton={addButton}
      />
    </>
  );
}
