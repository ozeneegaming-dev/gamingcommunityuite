import { normalizeCriteria, RANK_PRESETS, RANK_TIERS, RANKS_ACP_SECTION, rankEmblemArt } from "@gcs/modules";
import { GcsCard } from "@gcs/ui";
import { badgeArtSrc, GCS_BADGE_SHAPES } from "@gcs/ui/badge-art";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { services } from "@/lib/services";
import { GcsActionForm } from "../../../_components/GcsActionForm";
import { deleteRank, saveRankV2 } from "../actions";
import { GcsRankLadder, type GcsLadderCard } from "./GcsRankLadder";
import { GcsAcpTitle, GcsAcpTitleIcon } from "../../../_components/GcsAcpTitle";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.achievements"))("ranksTitle") };
}

const CRITERIA_ROWS = 2;

/**
 * ACP → Membri → Realizări → Ranguri (ranguri moderne): scara de carduri cu embleme, distribuția membrilor, ordinea
 * (tragere sau săgeți), copia, exportul / importul și scările prestabilite; sub ea, editorul fiecărui rang (pragurile,
 * criteriile aplicațiilor cu „toate / oricare”, emblema și avantajele).
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

  const cards: GcsLadderCard[] = ranks.map((r, i) => {
    const parts = [
      r.minPoints !== null ? t("v2.thrPoints", { n: r.minPoints }) : null,
      r.minPosts !== null ? t("v2.thrPosts", { n: r.minPosts }) : null,
      r.minReputation !== null ? t("v2.thrRep", { n: r.minReputation }) : null,
      ...normalizeCriteria(r.criteria).map((c) => `${metricLabel(c.metric)} ≥ ${c.min}`),
    ].filter((x): x is string => x !== null);
    return {
      id: r.id,
      name: r.name,
      art: badgeArtSrc(rankEmblemArt(r, i)),
      image: r.imageAttachmentId ? `/files/${r.imageAttachmentId}` : null,
      tier: r.emblemTier ?? RANK_TIERS[Math.min(RANK_TIERS.length - 1, i)]!,
      animated: r.animated,
      members: dist.get(r.id) ?? 0,
      summary: parts.join(r.match === "any" ? ` ${t("v2.or")} ` : " · "),
      perks: [nameOf(groups, r.perkGroupId), nameOf(badges, r.perkBadgeId), nameOf(styles, r.perkNameStyleId)].filter((x): x is string => x !== null),
    };
  });

  const select = (name: string, value: number | null, list: { id: number; name: string }[], text: string) => (
    <label className="gcs-field" style={{ width: 190 }}>
      {text}
      <select className="gcs-input" name={name} defaultValue={value ?? ""}>
        <option value="">{t("v2.none")}</option>
        {list.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </label>
  );

  const fields = (r?: (typeof ranks)[number]) => {
    const criteria = normalizeCriteria(r?.criteria);
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <label className="gcs-field" style={{ width: 180 }}>
            {t("name")}
            <input className="gcs-input" name="name" defaultValue={r?.name ?? ""} required maxLength={40} />
          </label>
          <label className="gcs-field" style={{ width: 80 }}>
            {t("icon")}
            <input className="gcs-input" name="icon" defaultValue={r?.icon ?? ""} maxLength={8} />
          </label>
          {(["minPosts", "minPoints", "minReputation"] as const).map((k) => (
            <label key={k} className="gcs-field" style={{ width: 130 }}>
              {t(k)}
              <input className="gcs-input" name={k} type="number" min={0} defaultValue={r?.[k] ?? ""} />
            </label>
          ))}
          <label className="gcs-field" style={{ width: 170 }}>
            {t("v2.match")}
            <select className="gcs-input" name="match" defaultValue={r?.match ?? "all"}>
              <option value="all">{t("v2.matchAll")}</option>
              <option value="any">{t("v2.matchAny")}</option>
            </select>
          </label>
        </div>
        <fieldset className="gcs-rankForm__criteria">
          <legend>{t("v2.criteria")}</legend>
          {Array.from({ length: CRITERIA_ROWS }, (_, i) => (
            <div key={i} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <select className="gcs-input" name="criterionMetric" aria-label={t("v2.criterionMetric", { n: i + 1 })} defaultValue={criteria[i]?.metric ?? ""} style={{ width: 220 }}>
                <option value="">{t("v2.none")}</option>
                {metrics.map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.off ? `${m.label} (${t("v2.appOff")})` : m.label}
                  </option>
                ))}
              </select>
              <input className="gcs-input" name="criterionMin" type="number" min={0} aria-label={t("v2.criterionMin", { n: i + 1 })} defaultValue={criteria[i]?.min ?? ""} style={{ width: 120 }} />
            </div>
          ))}
        </fieldset>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <label className="gcs-field" style={{ width: 150 }}>
            {t("v2.tier")}
            <select className="gcs-input" name="emblemTier" defaultValue={r?.emblemTier ?? ""}>
              <option value="">{t("v2.auto")}</option>
              {RANK_TIERS.map((k) => (
                <option key={k} value={k}>
                  {t(`v2.tiers.${k}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="gcs-field" style={{ width: 140 }}>
            {t("art.shape")}
            <select className="gcs-input" name="emblemShape" defaultValue={r?.emblemShape ?? ""}>
              <option value="">{t("v2.auto")}</option>
              {GCS_BADGE_SHAPES.map((k) => (
                <option key={k} value={k}>
                  {t(`art.shapes.${k}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="gcs-field" style={{ width: 200 }}>
            {t("art.icon")}
            <input className="gcs-input" name="emblemIcon" placeholder="fa-solid fa-crown" defaultValue={r?.emblemIcon ?? ""} maxLength={72} />
          </label>
          <label className="gcs-field" style={{ width: 120 }}>
            {t("color")}
            <input className="gcs-input" name="color" placeholder="#FFB224" defaultValue={r?.color ?? ""} maxLength={7} />
          </label>
          <label className="gcs-check">
            <input type="checkbox" name="animated" defaultChecked={r?.animated ?? false} />
            {t("v2.animated")}
          </label>
          <label className="gcs-field" style={{ width: 220 }}>
            {t("v2.emblemImage")}
            <input className="gcs-input" type="file" name="image" accept="image/png,image/jpeg,image/webp,image/gif" />
          </label>
          {r?.imageAttachmentId && (
            <label className="gcs-check">
              <input type="checkbox" name="removeImage" />
              {t("v2.removeImage")}
            </label>
          )}
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          {select("perkGroupId", r?.perkGroupId ?? null, groups, t("v2.perkGroup"))}
          {select("perkBadgeId", r?.perkBadgeId ?? null, badges, t("v2.perkBadge"))}
          {styles.length > 0 && select("perkNameStyleId", r?.perkNameStyleId ?? null, styles, t("v2.perkNameStyle"))}
        </div>
      </div>
    );
  };

  return (
    <>
      <GcsAcpTitle icon="fa-solid fa-ranking-star">{t("ranksTitle")}</GcsAcpTitle>
      <p className="gcs-muted" style={{ margin: 0 }}>
        {t("v2.ranksHelp")}
      </p>
      <GcsRankLadder
        key={ranks.map((r) => `${r.id}:${r.name}:${dist.get(r.id) ?? 0}`).join(",")}
        ranks={cards}
        unranked={dist.get(null) ?? 0}
        presets={RANK_PRESETS.map((p) => ({ key: p.key, label: t(`v2.preset.${p.key as "gaming"}`) }))}
      />
      {ranks.map((r) => (
        <GcsCard key={r.id} as="section" aria-label={r.name} style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }} data-testid="gcs-acp-rank">
          <GcsActionForm action={saveRankV2.bind(null, r.id)} submitLabel={t("save")} submitKind="save">
            {fields(r)}
          </GcsActionForm>
          <GcsActionForm action={deleteRank.bind(null, r.id)} submitLabel={t("delete")} submitKind="delete" variant="ghost" compact confirm={t("confirmDelete")}>
            {null}
          </GcsActionForm>
        </GcsCard>
      ))}
      <GcsCard as="section" aria-labelledby="gcs-rank-new" style={{ padding: 16 }}>
        <h2 id="gcs-rank-new" className="gcs-acpWidget__title" style={{ marginBottom: 12 }}>
          <GcsAcpTitleIcon name="fa-solid fa-plus" />
          {t("addRank")}
        </h2>
        <GcsActionForm action={saveRankV2.bind(null, null)} submitLabel={t("add")} submitKind="create">
          {fields()}
        </GcsActionForm>
      </GcsCard>
    </>
  );
}
