import { PROFILES_ACP_SECTION } from "@gcs/modules";
import { GcsButton, GcsCard } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { requireAcpSection } from "@/lib/acp";
import { GcsIconInput } from "@/lib/ui-inputs";
import { services } from "@/lib/services";
import { GcsAcpEditPanel } from "../../../_components/GcsAcpEditPanel";
import { GcsAcpTitle } from "../../../_components/GcsAcpTitle";
import { GcsActionForm } from "../../../_components/GcsActionForm";
import {
  deleteProfileField,
  deleteProfileFieldGroup,
  reorderProfileFieldGroups,
  reorderProfileFields,
  savePostbitOrder,
  saveProfileField,
  saveProfileFieldGroup,
  saveProfileSettings,
} from "./actions";
import { GcsPostbitOrder } from "./GcsPostbitOrder";
import { GcsProfileFieldForm, type GcsProfileFieldFormData } from "./GcsProfileFieldForm";
import { GcsProfileList, type GcsProfileListRow } from "./GcsProfileList";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.profiles"))("title") };
}

const BASE = "/admin/members/settings/profiles";
const TABS = ["fields", "groups", "postbit", "settings"] as const;
type Tab = (typeof TABS)[number];

/** Iconița unui câmp fără iconiță aleasă: după tipul lui. */
const TYPE_ICONS: Record<GcsProfileFieldFormData["type"], string> = {
  TEXT: "fa-solid fa-font",
  TEXTAREA: "fa-solid fa-align-left",
  URL: "fa-solid fa-link",
  NUMBER: "fa-solid fa-hashtag",
  SELECT: "fa-solid fa-list",
  IMAGE_SELECT: "fa-solid fa-images",
  SERVER_SELECT: "fa-solid fa-server",
};

type Props = { searchParams: Promise<{ tab?: string | string[] }> };

/**
 * ACP → Membri → Setări membri → Profiluri, pe patru file: câmpurile (listă + panou de editare), grupurile lor,
 * ordinea în postare și setările profilului. Doar elementul ales își deschide formularul, în panoul din dreapta.
 */
export default async function AcpProfilesPage({ searchParams }: Props) {
  await requireAcpSection(PROFILES_ACP_SECTION);
  const sp = await searchParams;
  const tab: Tab = TABS.find((k) => k === sp.tab) ?? "fields";
  const t = await getTranslations("acp.profiles");
  const { profiles, settings, profileFields } = services();
  const [fields, coverMaxMb, wallEnabled, postbitOrder, groups, faceitKey, sigMaxChars, sigMaxImages] = await Promise.all([
    profiles.fields(),
    settings.get<number>("profile.cover_max_mb"),
    settings.get<boolean>("profile.wall_enabled"),
    settings.get<string[]>("postbit.fields"),
    profileFields.groups(),
    settings.get<string>("profile.faceit_api_key"),
    settings.get<number>("profile.signature_max_chars"),
    settings.get<number>("profile.signature_max_images"),
  ]);
  type Field = (typeof fields)[number];
  type Group = (typeof groups)[number];
  const groupById = new Map(groups.map((g) => [g.id, g]));
  const groupOptions = groups.map((g) => ({ id: g.id, label: g.label }));
  const fieldIcon = (f: Field) => <GcsIcon name={f.icon ?? TYPE_ICONS[f.type]} />;
  const fieldMeta = (f: Field) => [t(`types.${f.type}`), f.groupId ? groupById.get(f.groupId)?.label : t(`sections.${f.section}`)].filter(Boolean).join(" · ");

  // ─── Câmpurile ────────────────────────────────────────────────────────────────────────────────────────────
  const fieldData = (f: Field): GcsProfileFieldFormData => ({
    key: f.key,
    label: f.label,
    type: f.type,
    maxLength: f.maxLength,
    helper: f.helper,
    groupId: f.groupId,
    section: f.section,
    visibility: f.visibility,
    icon: f.icon,
    required: f.required,
    showOnCard: f.showOnCard,
    showInPostbit: f.showInPostbit,
    options: f.options,
    optionImages: Object.fromEntries(Object.entries((f.optionImages ?? {}) as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === "string")),
    linkTemplate: f.linkTemplate,
  });
  const fieldForm = (f?: Field) => (
    <GcsActionForm action={saveProfileField.bind(null, f?.id ?? null)} submitLabel={f ? t("save") : t("add")} submitKind={f ? "save" : "create"}>
      <GcsProfileFieldForm field={f ? fieldData(f) : null} groups={groupOptions} />
    </GcsActionForm>
  );
  const newField = (testId: string, variant: "primary" | "ghost" = "primary") => (
    <GcsAcpEditPanel label={t("add")} variant={variant} buttonIcon={<GcsIcon name="fa-solid fa-plus" />} title={t("form.newTitle")} titleIcon={<GcsIcon name="fa-solid fa-plus" />} testId={testId}>
      {fieldForm()}
    </GcsAcpEditPanel>
  );
  const fieldRows: GcsProfileListRow[] = fields.map((f) => ({
    id: f.id,
    name: f.label,
    key: f.key,
    meta: fieldMeta(f),
    icon: fieldIcon(f),
    section: f.section,
    groupId: f.groupId,
    chips: [
      { label: t(`list.visibility.${f.visibility}`), tone: "neutral" as const },
      ...(f.showOnCard ? [{ label: t("list.onCard"), tone: "accent" as const }] : []),
      ...(f.showInPostbit ? [{ label: t("list.inPostbit"), tone: "accent" as const }] : []),
      ...(f.required ? [{ label: t("required"), tone: "warn" as const }] : []),
    ],
    edit: (
      <GcsAcpEditPanel
        iconOnly
        label={t("list.editField", { name: f.label })}
        title={f.label}
        titleIcon={fieldIcon(f)}
        aside={<code className="gcs-acpProf__key">{f.key}</code>}
        testId="gcs-acp-field-edit"
        footer={
          <GcsActionForm action={deleteProfileField.bind(null, f.id)} submitLabel={t("delete")} submitKind="delete" variant="ghost" compact confirm={t("confirmDelete")}>
            {null}
          </GcsActionForm>
        }
      >
        {fieldForm(f)}
      </GcsAcpEditPanel>
    ),
  }));

  // ─── Grupurile câmpurilor ─────────────────────────────────────────────────────────────────────────────────
  const groupForm = (g?: Group) => (
    <GcsActionForm action={saveProfileFieldGroup.bind(null, g?.id ?? null)} submitLabel={g ? t("save") : t("groups.add")} submitKind={g ? "save" : "create"}>
      <fieldset className="gcs-formSec">
        <legend>{t("form.basics")}</legend>
        <div className="gcs-formGrid">
          <label className="gcs-field">
            {t("form.label")}
            <input className="gcs-input" name="label" defaultValue={g?.label ?? ""} required maxLength={60} data-testid="gcs-acp-group-label" />
          </label>
          <label className="gcs-field">
            {t("form.key")}
            <input className="gcs-input gcs-acpProf__mono" name="key" defaultValue={g?.key ?? ""} required pattern="[a-z0-9_]{2,40}" readOnly={Boolean(g)} data-testid="gcs-acp-group-key" />
            <span className="gcs-field__hint">{g ? t("form.keyLocked") : t("form.keyHint")}</span>
          </label>
          <label className="gcs-field gcs-formGrid__wide">
            {t("groups.helper")}
            <textarea className="gcs-input" name="helper" rows={2} defaultValue={g?.helper ?? ""} maxLength={300} placeholder={t("groups.helperHint")} />
          </label>
        </div>
      </fieldset>
      <fieldset className="gcs-formSec">
        <legend>{t("form.look")}</legend>
        <div className="gcs-field" role="group" aria-label={t("form.icon")}>
          <span>{t("form.icon")}</span>
          <GcsIconInput name="icon" value={g?.icon ?? null} testId="gcs-acp-group-icon" />
        </div>
      </fieldset>
    </GcsActionForm>
  );
  const newGroup = (testId: string, variant: "primary" | "ghost" = "primary") => (
    <GcsAcpEditPanel label={t("groups.new")} variant={variant} buttonIcon={<GcsIcon name="fa-solid fa-plus" />} title={t("groups.newTitle")} titleIcon={<GcsIcon name="fa-solid fa-layer-group" />} testId={testId}>
      {groupForm()}
    </GcsAcpEditPanel>
  );
  const fieldsIn = (g: Group) => fields.filter((f) => f.groupId === g.id).length;
  const groupIcon = (g: Group) => <GcsIcon name={g.icon ?? "fa-solid fa-layer-group"} />;
  const groupRows: GcsProfileListRow[] = groups.map((g) => ({
    id: g.id,
    name: g.label,
    key: g.key,
    meta: g.helper,
    icon: groupIcon(g),
    chips: [{ label: t("groups.count", { count: fieldsIn(g) }), tone: "neutral" as const }],
    edit: (
      <GcsAcpEditPanel
        iconOnly
        label={t("groups.edit", { name: g.label })}
        title={g.label}
        titleIcon={groupIcon(g)}
        aside={<code className="gcs-acpProf__key">{g.key}</code>}
        testId="gcs-acp-group-edit"
        footer={
          <GcsActionForm action={deleteProfileFieldGroup.bind(null, g.id)} submitLabel={t("delete")} submitKind="delete" variant="ghost" compact confirm={t("groups.confirmDelete")}>
            {null}
          </GcsActionForm>
        }
      >
        {groupForm(g)}
      </GcsAcpEditPanel>
    ),
  }));

  // ─── Ordinea în postare ───────────────────────────────────────────────────────────────────────────────────
  const postbitFields = fields
    .filter((f) => f.showInPostbit)
    .sort((a, b) => {
      const pos = (k: string) => (postbitOrder.indexOf(k) < 0 ? Number.MAX_SAFE_INTEGER : postbitOrder.indexOf(k));
      return pos(a.key) - pos(b.key) || a.position - b.position;
    });

  const tabLabel: Record<Tab, ReactNode> = {
    fields: (
      <>
        {t("tabs.fields")} <em className="gcs-acpProf__count">{fields.length}</em>
      </>
    ),
    groups: (
      <>
        {t("tabs.groups")} <em className="gcs-acpProf__count">{groups.length}</em>
      </>
    ),
    postbit: t("tabs.postbit"),
    settings: t("tabs.settings"),
  };
  const tabIcon: Record<Tab, string> = {
    fields: "fa-solid fa-list-ul",
    groups: "fa-solid fa-layer-group",
    postbit: "fa-solid fa-arrow-down-1-9",
    settings: "fa-solid fa-sliders",
  };

  return (
    <>
      <GcsAcpTitle icon="fa-solid fa-id-card" description={t("description")} actions={tab === "groups" ? newGroup("gcs-acp-group-new") : newField("gcs-acp-field-new")}>
        {t("title")}
      </GcsAcpTitle>
      <nav className="gcs-tabs gcs-acpProf__tabs" aria-label={t("tabs.label")} data-testid="gcs-acp-profiles-tabs">
        {TABS.map((k) => (
          <Link
            key={k}
            href={k === "fields" ? BASE : `${BASE}?tab=${k}`}
            className={`gcs-tab${tab === k ? " gcs-tab--active" : ""}`}
            aria-current={tab === k ? "page" : undefined}
            data-testid={`gcs-acp-profiles-tab-${k}`}
          >
            <GcsIcon name={tabIcon[k]} className="gcs-tab__icon" /> {tabLabel[k]}
          </Link>
        ))}
      </nav>

      {tab === "fields" && (
        <GcsCard as="section" aria-label={t("tabs.fields")} className="gcs-acpProf__card" data-testid="gcs-acp-profile-fields-card">
          <GcsProfileList
            rows={fieldRows}
            reorder={reorderProfileFields}
            filters={{
              sections: (["ABOUT", "GAMES"] as const).map((s) => ({ value: s, label: t(`sections.${s}`) })),
              groups: groups.map((g) => ({ value: String(g.id), label: g.label })),
            }}
            testId="gcs-acp-profile-fields"
            rowTestId="gcs-acp-profile-field"
            empty={
              <Empty icon="fa-solid fa-id-card" title={t("empty.fieldsTitle")} text={t("empty.fieldsText")}>
                {newField("gcs-acp-field-new-empty")}
              </Empty>
            }
          />
        </GcsCard>
      )}

      {tab === "groups" && (
        <GcsCard as="section" aria-label={t("tabs.groups")} className="gcs-acpProf__card" data-testid="gcs-acp-field-groups">
          <p className="gcs-acpProf__intro">{t("groups.hint")}</p>
          <GcsProfileList
            rows={groupRows}
            reorder={reorderProfileFieldGroups}
            testId="gcs-acp-field-group-list"
            rowTestId="gcs-acp-field-group-row"
            empty={
              <Empty icon="fa-solid fa-layer-group" title={t("empty.groupsTitle")} text={t("empty.groupsText")}>
                {newGroup("gcs-acp-group-new-empty")}
              </Empty>
            }
          />
        </GcsCard>
      )}

      {tab === "postbit" && (
        <GcsCard as="section" aria-label={t("tabs.postbit")} className="gcs-acpProf__card" data-testid="gcs-acp-postbit">
          <p className="gcs-acpProf__intro">{t("postbitHint")}</p>
          {postbitFields.length > 0 ? (
            <GcsActionForm action={savePostbitOrder} submitLabel={t("postbitSave")} submitKind="save" className="gcs-acpProf__postbitForm">
              <GcsPostbitOrder fields={postbitFields.map((f) => ({ id: f.key, name: f.label, icon: fieldIcon(f), meta: fieldMeta(f) }))} />
            </GcsActionForm>
          ) : (
            <Empty icon="fa-solid fa-arrow-down-1-9" title={t("empty.postbitTitle")} text={t("empty.postbitText")}>
              <GcsButton asChild variant="ghost" size="sm" icon={<GcsIcon name="fa-solid fa-list-ul" />}>
                <Link href={BASE}>{t("empty.postbitAction")}</Link>
              </GcsButton>
            </Empty>
          )}
        </GcsCard>
      )}

      {tab === "settings" && (
        <GcsCard as="section" aria-label={t("tabs.settings")} className="gcs-acpProf__card gcs-acpProf__card--form">
          <GcsActionForm action={saveProfileSettings} submitLabel={t("save")} submitKind="save" className="gcs-acpProf__settings">
            <fieldset className="gcs-formSec">
              <legend>{t("settings.profile")}</legend>
              <div className="gcs-formGrid">
                <label className="gcs-field">
                  {t("coverMaxMb")}
                  <input className="gcs-input" name="coverMaxMb" type="number" step="0.5" min={0.1} max={50} defaultValue={coverMaxMb} />
                </label>
              </div>
              <label className="gcs-toggleRow">
                <span>{t("wallEnabled")}</span>
                <input type="checkbox" role="switch" className="gcs-switch" name="wallEnabled" defaultChecked={wallEnabled} />
              </label>
            </fieldset>
            <fieldset className="gcs-formSec">
              <legend>{t("settings.signature")}</legend>
              <div className="gcs-formGrid">
                <label className="gcs-field">
                  {t("signatureMaxChars")}
                  <input className="gcs-input" name="signatureMaxChars" type="number" min={0} max={5000} step={1} defaultValue={sigMaxChars} />
                  <span className="gcs-field__hint">{t("signatureMaxCharsHint")}</span>
                </label>
                <label className="gcs-field">
                  {t("signatureMaxImages")}
                  <input className="gcs-input" name="signatureMaxImages" type="number" min={0} max={5} step={1} defaultValue={sigMaxImages} />
                </label>
              </div>
            </fieldset>
            <fieldset className="gcs-formSec">
              <legend>{t("settings.faceit")}</legend>
              <label className="gcs-field">
                {t("faceitKey")}
                <input
                  className="gcs-input"
                  name="faceitKey"
                  type="password"
                  autoComplete="off"
                  placeholder={faceitKey ? t("faceitKeySet") : t("faceitKeyEmpty")}
                  aria-describedby="gcs-acp-faceit-hint"
                  data-testid="gcs-acp-faceit-key"
                />
                <span id="gcs-acp-faceit-hint" className="gcs-field__hint">
                  {t("faceitHint")}
                </span>
              </label>
              {faceitKey && (
                <label className="gcs-toggleRow">
                  <span>{t("faceitClear")}</span>
                  <input type="checkbox" role="switch" className="gcs-switch" name="faceitClear" />
                </label>
              )}
            </fieldset>
            <fieldset className="gcs-formSec">
              <legend>{t("settings.elsewhere")}</legend>
              {/* Pragul insignei „Sponsor” stă într-un singur loc, lângă perioada lui: Donații › Setări. */}
              <p className="gcs-field__hint" style={{ margin: 0 }}>
                {t("sponsorMoved")} <a href="/admin/settings/donations#profile.sponsor_min_amount">{t("sponsorLink")}</a>
              </p>
            </fieldset>
          </GcsActionForm>
        </GcsCard>
      )}
    </>
  );
}

/** Starea goală a unei file: iconița, ce lipsește și butonul care rezolvă. */
function Empty({ icon, title, text, children }: { icon: string; title: string; text: string; children: ReactNode }) {
  return (
    <div className="gcs-acpProf__empty" data-testid="gcs-acp-profiles-empty">
      <span className="gcs-acpProf__emptyIcon" aria-hidden="true">
        <GcsIcon name={icon} />
      </span>
      <b>{title}</b>
      <p>{text}</p>
      {children}
    </div>
  );
}
