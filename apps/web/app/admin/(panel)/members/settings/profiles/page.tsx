import { PROFILES_ACP_SECTION } from "@gcs/modules";
import { GcsCard, GcsIconPicker } from "@gcs/ui";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { services } from "@/lib/services";
import { GcsActionForm } from "../../../_components/GcsActionForm";
import { deleteProfileField, deleteProfileFieldGroup, savePostbitOrder, saveProfileField, saveProfileFieldGroup, saveProfileSettings } from "./actions";
import { GcsAcpTitle, GcsAcpTitleIcon } from "../../../_components/GcsAcpTitle";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.profiles"))("title") };
}

/** ACP → Membri → Setări membri → Profiluri: câmpurile custom și setările profilului. */
export default async function AcpProfilesPage() {
  await requireAcpSection(PROFILES_ACP_SECTION);
  const t = await getTranslations("acp.profiles");
  const { profiles, settings, profileFields } = services();
  const [fields, coverMaxMb, wallEnabled, postbitOrder, groups, sponsorMin, faceitKey] = await Promise.all([
    profiles.fields(),
    settings.get<number>("profile.cover_max_mb"),
    settings.get<boolean>("profile.wall_enabled"),
    settings.get<string[]>("postbit.fields"),
    profileFields.groups(),
    settings.get<number>("profile.sponsor_min_amount"),
    settings.get<string>("profile.faceit_api_key"),
  ]);
  const groupForm = (g?: (typeof groups)[number]) => (
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
      <label className="gcs-field" style={{ width: 150 }}>
        {t("key")}
        <input className="gcs-input" name="key" defaultValue={g?.key ?? ""} required pattern="[a-z0-9_]{2,40}" readOnly={Boolean(g)} />
      </label>
      <label className="gcs-field" style={{ width: 200 }}>
        {t("label")}
        <input className="gcs-input" name="label" defaultValue={g?.label ?? ""} required maxLength={60} />
      </label>
      <label className="gcs-field" style={{ flex: "1 1 260px" }}>
        {t("groups.helper")}
        <input className="gcs-input" name="helper" defaultValue={g?.helper ?? ""} maxLength={300} placeholder={t("groups.helperHint")} />
      </label>
      <label className="gcs-field" style={{ width: 90 }}>
        {t("position")}
        <input className="gcs-input" name="position" type="number" defaultValue={g?.position ?? groups.length} />
      </label>
      <div className="gcs-field" role="group" aria-label={t("icon")}>
        <span>{t("icon")}</span>
        <GcsIconPicker name="icon" value={g?.icon ?? null} searchUrl="/api/icons/search" labels={{ search: t("iconSearch"), none: t("iconNone"), noResults: t("iconNoResults") }} />
      </div>
    </div>
  );
  const postbitFields = fields
    .filter((f) => f.showInPostbit)
    .sort((a, b) => {
      const pos = (k: string) => (postbitOrder.indexOf(k) < 0 ? Number.MAX_SAFE_INTEGER : postbitOrder.indexOf(k));
      return pos(a.key) - pos(b.key) || a.position - b.position;
    });
  const imageLines = (f?: (typeof fields)[number]) =>
    Object.entries((f?.optionImages ?? {}) as Record<string, string>)
      .map(([o, url]) => `${o} = ${url}`)
      .join("\n");

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
            {(["TEXT", "TEXTAREA", "URL", "NUMBER", "SELECT", "IMAGE_SELECT", "SERVER_SELECT"] as const).map((k) => (
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
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
        <label className="gcs-field" style={{ width: 200 }}>
          {t("groups.group")}
          <select className="gcs-input" name="groupId" defaultValue={f?.groupId ? String(f.groupId) : ""} data-testid="gcs-acp-field-group">
            <option value="">{t("groups.none")}</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.label}
              </option>
            ))}
          </select>
        </label>
        <label className="gcs-field" style={{ flex: "1 1 260px" }}>
          {t("fieldHelper")}
          <input className="gcs-input" name="helper" defaultValue={f?.helper ?? ""} maxLength={300} placeholder={t("fieldHelperHint")} />
        </label>
        <label className="gcs-field" style={{ flex: "1 1 260px" }}>
          {t("linkTemplate")}
          <input className="gcs-input" name="linkTemplate" defaultValue={f?.linkTemplate ?? ""} placeholder="https://x.com/{handle}" data-testid="gcs-acp-field-template" />
        </label>
      </div>
      <p className="gcs-field__hint" style={{ margin: 0 }}>
        {t("linkTemplateHint")}
      </p>
      <label className="gcs-field">
        {t("options")}
        <input className="gcs-input" name="options" defaultValue={f?.options.join(", ") ?? ""} placeholder={t("optionsHint")} />
      </label>
      <label className="gcs-field">
        {t("optionImages")}
        <textarea className="gcs-input" name="optionImages" rows={3} defaultValue={imageLines(f)} placeholder={t("optionImagesHint")} />
      </label>
      <div className="gcs-field" role="group" aria-label={t("icon")}>
        <span>{t("icon")}</span>
        <GcsIconPicker name="icon" value={f?.icon ?? null} searchUrl="/api/icons/search" labels={{ search: t("iconSearch"), none: t("iconNone"), noResults: t("iconNoResults") }} />
      </div>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <label className="gcs-check">
          <input type="checkbox" name="required" defaultChecked={f?.required ?? false} />
          {t("required")}
        </label>
        <label className="gcs-check">
          <input type="checkbox" name="showOnCard" defaultChecked={f?.showOnCard ?? false} />
          {t("showOnCard")}
        </label>
        <label className="gcs-check">
          <input type="checkbox" name="showInPostbit" defaultChecked={f?.showInPostbit ?? false} />
          {t("showInPostbit")}
        </label>
      </div>
    </div>
  );

  return (
    <>
      <GcsAcpTitle icon="fa-solid fa-id-card">
        {t("title")}
      </GcsAcpTitle>
      <GcsCard as="section" aria-label={t("settingsTitle")} style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
        <h2 className="gcs-acpWidget__title"><GcsAcpTitleIcon name="fa-solid fa-sliders" />{t("settingsTitle")}</h2>
        <GcsActionForm action={saveProfileSettings} submitLabel={t("save")} submitKind="save">
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-end" }}>
            <label className="gcs-field" style={{ width: 200 }}>
              {t("coverMaxMb")}
              <input className="gcs-input" name="coverMaxMb" type="number" step="0.5" min={0.1} max={50} defaultValue={coverMaxMb} />
            </label>
            <label className="gcs-check">
              <input type="checkbox" name="wallEnabled" defaultChecked={wallEnabled} />
              {t("wallEnabled")}
            </label>
            <label className="gcs-field" style={{ width: 220 }}>
              {t("sponsorMin")}
              <input className="gcs-input" name="sponsorMin" type="number" step="1" min={0} max={1000000} defaultValue={sponsorMin} />
            </label>
            <label className="gcs-field" style={{ width: 280 }}>
              {t("faceitKey")}
              <input className="gcs-input" name="faceitKey" type="password" autoComplete="off" placeholder={faceitKey ? t("faceitKeySet") : t("faceitKeyEmpty")} data-testid="gcs-acp-faceit-key" />
            </label>
            {faceitKey && (
              <label className="gcs-check">
                <input type="checkbox" name="faceitClear" />
                {t("faceitClear")}
              </label>
            )}
          </div>
          <p className="gcs-field__hint" style={{ margin: 0 }}>
            {t("faceitHint")}
          </p>
        </GcsActionForm>
      </GcsCard>
      {/* Profil gaming v2: grupurile câmpurilor (titlul și textul de ajutor din „Editează profilul”). */}
      <GcsCard as="section" aria-labelledby="gcs-field-groups" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }} data-testid="gcs-acp-field-groups">
        <h2 id="gcs-field-groups" className="gcs-acpWidget__title">
          <GcsAcpTitleIcon name="fa-solid fa-layer-group" />
          {t("groups.title")}
        </h2>
        <p className="gcs-muted" style={{ margin: 0 }}>
          {t("groups.hint")}
        </p>
        {groups.map((g) => (
          <div key={g.id} className="gcs-acpFieldGroup" data-testid="gcs-acp-field-group-row">
            <GcsActionForm action={saveProfileFieldGroup.bind(null, g.id)} submitLabel={t("save")} submitKind="save" compact>
              {groupForm(g)}
            </GcsActionForm>
            <GcsActionForm action={deleteProfileFieldGroup.bind(null, g.id)} submitLabel={t("delete")} submitKind="delete" variant="ghost" compact confirm={t("groups.confirmDelete")}>
              {null}
            </GcsActionForm>
          </div>
        ))}
        <h3 className="gcs-acpWidget__title" style={{ fontSize: 14 }}>
          <GcsAcpTitleIcon name="fa-solid fa-plus" />
          {t("groups.add")}
        </h3>
        <GcsActionForm action={saveProfileFieldGroup.bind(null, null)} submitLabel={t("groups.add")} submitKind="create">
          {groupForm()}
        </GcsActionForm>
      </GcsCard>
      <GcsCard as="section" aria-labelledby="gcs-postbit-order" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }} data-testid="gcs-acp-postbit">
        <h2 id="gcs-postbit-order" className="gcs-acpWidget__title">
          <GcsAcpTitleIcon name="fa-solid fa-arrow-down-1-9" />
          {t("postbitTitle")}
        </h2>
        <p className="gcs-muted" style={{ margin: 0 }}>
          {t("postbitHint")}
        </p>
        {postbitFields.length > 0 && (
          <GcsActionForm action={savePostbitOrder} submitLabel={t("postbitSave")} submitKind="save">
            <ol style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 6 }}>
              {postbitFields.map((f, i) => (
                <li key={f.key}>
                  <label style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <input className="gcs-input" type="number" name={`order.${f.key}`} defaultValue={i + 1} min={1} max={99} style={{ width: 80 }} aria-label={t("postbitPosition", { field: f.label })} />
                    {f.label}
                  </label>
                </li>
              ))}
            </ol>
          </GcsActionForm>
        )}
      </GcsCard>
      {fields.map((f) => (
        <GcsCard key={f.id} as="section" aria-label={f.label} style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }} data-testid="gcs-acp-profile-field">
          <GcsActionForm action={saveProfileField.bind(null, f.id)} submitLabel={t("save")} submitKind="save">
            {form(f)}
          </GcsActionForm>
          <GcsActionForm action={deleteProfileField.bind(null, f.id)} submitLabel={t("delete")} submitKind="delete" variant="ghost" compact confirm={t("confirmDelete")}>
            {null}
          </GcsActionForm>
        </GcsCard>
      ))}
      <GcsCard as="section" aria-labelledby="gcs-field-new" style={{ padding: 16 }}>
        <h2 id="gcs-field-new" className="gcs-acpWidget__title" style={{ marginBottom: 12 }}>
          <GcsAcpTitleIcon name="fa-solid fa-plus" />
          {t("add")}
        </h2>
        <GcsActionForm action={saveProfileField.bind(null, null)} submitLabel={t("add")} submitKind="create">
          {form()}
        </GcsActionForm>
      </GcsCard>
    </>
  );
}
