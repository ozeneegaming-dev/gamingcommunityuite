import { FRAMES_ACP_SECTION, type GcsFrameStyle } from "@gcs/modules";
import { GcsAvatar, GcsCard } from "@gcs/ui";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { services } from "@/lib/services";
import { GcsActionForm } from "../../_components/GcsActionForm";
import { deleteFrame, saveFrame } from "../actions";
import { Availability } from "../Availability";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.vip"))("framesTitle") };
}

const SIZES = ["xs", "s", "m", "l", "xl"] as const;

/** ACP → VIP → Avatar frames: rame CSS (conic-gradient) sau imagine, cu previzualizare la toate mărimile. */
export default async function AcpFramesPage() {
  await requireAcpSection(FRAMES_ACP_SECTION);
  const t = await getTranslations("acp.vip");
  const { db } = services();
  const [frames, groups, badges] = await Promise.all([
    db.avatarFrame.findMany({ orderBy: [{ position: "asc" }, { id: "asc" }] }),
    db.group.findMany({ orderBy: { position: "asc" }, select: { id: true, name: true } }),
    db.badge.findMany({ orderBy: { position: "asc" }, select: { id: true, name: true, symbol: true } }),
  ]);
  const availabilityLabels = { title: t("availability"), all: t("availableAll"), groups: t("availableGroups"), badges: t("availableBadges") };

  const fields = (f?: (typeof frames)[number]) => {
    const style = (f?.style ?? null) as Partial<GcsFrameStyle> | null;
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <label className="gcs-field" style={{ width: 130 }}>
            {t("key")}
            <input className="gcs-input" name="key" defaultValue={f?.key ?? ""} required pattern="[a-z0-9_]{2,40}" readOnly={Boolean(f)} />
          </label>
          <label className="gcs-field" style={{ width: 160 }}>
            {t("name")}
            <input className="gcs-input" name="name" defaultValue={f?.name ?? ""} required maxLength={40} />
          </label>
          <label className="gcs-field" style={{ width: 130 }}>
            {t("kind")}
            <select className="gcs-input" name="kind" defaultValue={f?.kind ?? "CSS"}>
              <option value="CSS">CSS</option>
              <option value="IMAGE">{t("image")}</option>
            </select>
          </label>
          <label className="gcs-field" style={{ flex: "1 1 240px" }}>
            {t("colors")}
            <input className="gcs-input" name="colors" defaultValue={style?.colors?.join(", ") ?? "#FF3B3B, #FFE066"} placeholder="#22D3EE, #B794FF, #FF7AC6" />
          </label>
          <label className="gcs-field" style={{ width: 90 }}>
            {t("width")}
            <input className="gcs-input" name="width" type="number" min={2} max={8} defaultValue={style?.width ?? 3} />
          </label>
          <label className="gcs-field" style={{ width: 110 }}>
            {t("glow")}
            <input className="gcs-input" name="glow" defaultValue={style?.glow ?? ""} placeholder="#22D3EE" pattern="#[0-9A-Fa-f]{6}" />
          </label>
          <label className="gcs-check">
            <input type="checkbox" name="spin" defaultChecked={style?.spin !== false} />
            {t("spin")}
          </label>
          <label className="gcs-field" style={{ width: 220 }}>
            {t("imageFile")}
            <input name="image" type="file" accept="image/png,image/webp,image/gif" />
          </label>
        </div>
        <Availability value={f ?? { allGroups: false, groupIds: [], badgeIds: [] }} groups={groups} badges={badges} labels={availabilityLabels} />
      </div>
    );
  };

  return (
    <>
      <h1 className="gcs-display" style={{ margin: 0, fontSize: 28, fontWeight: 700 }}>
        {t("framesTitle")}
      </h1>
      <p className="gcs-muted" style={{ margin: 0 }}>
        {t("framesHelp")}
      </p>
      {frames.map((f) => (
        <GcsCard key={f.id} as="section" aria-label={f.name} style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }} data-testid="gcs-acp-frame">
          <div style={{ display: "flex", gap: 16, alignItems: "flex-end", flexWrap: "wrap" }} aria-label={t("preview")}>
            {SIZES.map((size) => (
              <GcsAvatar key={size} name={f.name} size={size} frame={f.key} />
            ))}
          </div>
          <GcsActionForm action={saveFrame.bind(null, f.id)} submitLabel={t("save")}>
            {fields(f)}
          </GcsActionForm>
          <GcsActionForm action={deleteFrame.bind(null, f.id)} submitLabel={t("delete")} variant="ghost" compact confirm={t("confirmDelete")}>
            {null}
          </GcsActionForm>
        </GcsCard>
      ))}
      <GcsCard as="section" aria-labelledby="gcs-frame-new" style={{ padding: 16 }}>
        <h2 id="gcs-frame-new" className="gcs-acpWidget__title" style={{ marginBottom: 12 }}>
          {t("addFrame")}
        </h2>
        <GcsActionForm action={saveFrame.bind(null, null)} submitLabel={t("addFrame")}>
          {fields()}
        </GcsActionForm>
      </GcsCard>
    </>
  );
}
