import { PROFILES_ACP_SECTION } from "@gcs/modules";
import { GcsCard } from "@gcs/ui";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { services } from "@/lib/services";
import { GcsActionForm } from "../../../_components/GcsActionForm";
import { deleteProfileField, saveProfileField, saveProfileSettings } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.profiles"))("title") };
}

/** ACP → Membri → Setări membri → Profiluri: câmpurile custom și setările profilului. */
export default async function AcpProfilesPage() {
  await requireAcpSection(PROFILES_ACP_SECTION);
  const t = await getTranslations("acp.profiles");
  const { profiles, settings } = services();
  const [fields, coverMaxMb, wallEnabled] = await Promise.all([profiles.fields(), settings.get<number>("profile.cover_max_mb"), settings.get<boolean>("profile.wall_enabled")]);

  const form = (f?: (typeof fields)[number]) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
        <label className="gcs-field" style={{ width: 150 }}>
          {t("key")}
          <input className="gcs-input" name="key" defaultValue={f?.key ?? ""} required pattern="[a-z0-9_]{2,40}" readOnly={Boolean(f)} />
        </label>
        <label className="gcs-field" style={{ width: 200 }}>
          {t("label")}
          <input className="gcs-input" name="label" defaultValue={f?.label ?? ""} required maxLength={60} />
        </label>
        <label className="gcs-field" style={{ width: 150 }}>
          {t("type")}
          <select className="gcs-input" name="type" defaultValue={f?.type ?? "TEXT"}>
            {(["TEXT", "TEXTAREA", "URL", "NUMBER", "SELECT"] as const).map((k) => (
              <option key={k} value={k}>
                {t(`types.${k}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="gcs-field" style={{ width: 170 }}>
          {t("section")}
          <select className="gcs-input" name="section" defaultValue={f?.section ?? "ABOUT"}>
            <option value="ABOUT">{t("sections.ABOUT")}</option>
            <option value="GAMES">{t("sections.GAMES")}</option>
          </select>
        </label>
        <label className="gcs-field" style={{ width: 170 }}>
          {t("visibility")}
          <select className="gcs-input" name="visibility" defaultValue={f?.visibility ?? "PUBLIC"}>
            {(["PUBLIC", "MEMBERS", "STAFF"] as const).map((k) => (
              <option key={k} value={k}>
                {t(`visibilities.${k}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="gcs-field" style={{ width: 100 }}>
          {t("maxLength")}
          <input className="gcs-input" name="maxLength" type="number" min={1} max={5000} defaultValue={f?.maxLength ?? 200} />
        </label>
        <label className="gcs-field" style={{ width: 90 }}>
          {t("position")}
          <input className="gcs-input" name="position" type="number" defaultValue={f?.position ?? fields.length} />
        </label>
      </div>
      <label className="gcs-field">
        {t("options")}
        <input className="gcs-input" name="options" defaultValue={f?.options.join(", ") ?? ""} placeholder={t("optionsHint")} />
      </label>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <label className="gcs-check">
          <input type="checkbox" name="required" defaultChecked={f?.required ?? false} />
          {t("required")}
        </label>
        <label className="gcs-check">
          <input type="checkbox" name="showOnCard" defaultChecked={f?.showOnCard ?? false} />
          {t("showOnCard")}
        </label>
      </div>
    </div>
  );

  return (
    <>
      <h1 className="gcs-display" style={{ margin: 0, fontSize: 28, fontWeight: 700 }}>
        {t("title")}
      </h1>
      <GcsCard as="section" aria-label={t("settingsTitle")} style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
        <h2 className="gcs-acpWidget__title">{t("settingsTitle")}</h2>
        <GcsActionForm action={saveProfileSettings} submitLabel={t("save")}>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-end" }}>
            <label className="gcs-field" style={{ width: 200 }}>
              {t("coverMaxMb")}
              <input className="gcs-input" name="coverMaxMb" type="number" step="0.5" min={0.1} max={50} defaultValue={coverMaxMb} />
            </label>
            <label className="gcs-check">
              <input type="checkbox" name="wallEnabled" defaultChecked={wallEnabled} />
              {t("wallEnabled")}
            </label>
          </div>
        </GcsActionForm>
      </GcsCard>
      {fields.map((f) => (
        <GcsCard key={f.id} as="section" aria-label={f.label} style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }} data-testid="gcs-acp-profile-field">
          <GcsActionForm action={saveProfileField.bind(null, f.id)} submitLabel={t("save")}>
            {form(f)}
          </GcsActionForm>
          <GcsActionForm action={deleteProfileField.bind(null, f.id)} submitLabel={t("delete")} variant="ghost" compact confirm={t("confirmDelete")}>
            {null}
          </GcsActionForm>
        </GcsCard>
      ))}
      <GcsCard as="section" aria-labelledby="gcs-field-new" style={{ padding: 16 }}>
        <h2 id="gcs-field-new" className="gcs-acpWidget__title" style={{ marginBottom: 12 }}>
          {t("add")}
        </h2>
        <GcsActionForm action={saveProfileField.bind(null, null)} submitLabel={t("add")}>
          {form()}
        </GcsActionForm>
      </GcsCard>
    </>
  );
}
