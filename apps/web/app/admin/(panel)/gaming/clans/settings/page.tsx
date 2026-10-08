import { CLAN_FORUM_MODES, CLAN_OFFICER_RIGHTS, CLAN_REQUIRED_FIELDS, CLAN_SETTING, CLAN_TAG_PLACES, CLANS_SETTINGS_ACP_SECTION, GCS_TAG_CHARSETS, type GcsClanOptions } from "@gcs/modules";
import { GcsCard } from "@gcs/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { requireAcpSection } from "@/lib/acp";
import { services } from "@/lib/services";
import { GcsActionForm } from "../../../_components/GcsActionForm";
import { GcsAcpTitle, GcsAcpTitleIcon } from "../../../_components/GcsAcpTitle";
import { recomputeClanRanking, saveClanGroups, saveClanSettings } from "../actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.clans"))("settingsTitle") };
}

const TABS = ["create", "tag", "members", "forum", "ranking", "display", "groups"] as const;
type Tab = (typeof TABS)[number];
const TAB_ICONS: Record<Tab, string> = {
  create: "fa-solid fa-flag",
  tag: "fa-solid fa-tag",
  members: "fa-solid fa-users",
  forum: "fa-solid fa-comments",
  ranking: "fa-solid fa-ranking-star",
  display: "fa-solid fa-eye",
  groups: "fa-solid fa-user-shield",
};

type Props = { searchParams: Promise<{ tab?: string }> };

/** Un rând de formular: eticheta, controlul și explicația. */
function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="gcs-field" style={{ maxWidth: 520 }}>
      {label}
      {children}
      {hint && <span className="gcs-field__hint">{hint}</span>}
    </label>
  );
}

/**
 * ACP → Gaming → Clanuri → Setări (specul 2026-10-08-clanuri §3.2): opțiunile pe tab-uri (crearea, tagul, membrii,
 * forumul privat, clasamentul, afișarea) și tab-ul „Grupuri” (cine creează, cine intră, limitele, staff-ul pe site).
 */
export default async function AcpClanSettingsPage({ searchParams }: Props) {
  const { actor } = await requireAcpSection(CLANS_SETTINGS_ACP_SECTION);
  const sp = await searchParams;
  const tab: Tab = TABS.includes(sp.tab as Tab) ? (sp.tab as Tab) : "create";
  const { clanQueries, db, permissions, acp } = services();
  const [t, o, forums, groups, canGroups] = await Promise.all([
    getTranslations("acp.clans.settings"),
    clanQueries.options(),
    db.forum.findMany({ where: { type: { in: ["CATEGORY", "FORUM"] } }, orderBy: [{ parentId: "asc" }, { position: "asc" }], select: { id: true, name: true, type: true, parentId: true } }),
    db.group.findMany({ orderBy: { position: "asc" }, select: { id: true, key: true, name: true } }),
    acp.can(actor, "members.groups", "edit"),
  ]);
  const name = (key: string) => `setting:${key}`;
  const save = saveClanSettings.bind(null, tab);
  const parentOk = forums.some((f) => f.id === o.forumParent);

  const checks = (key: string, values: readonly string[], chosen: readonly string[], label: (v: string) => string) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {values.map((v) => (
        <label key={v} className="gcs-check">
          <input type="checkbox" name={name(key)} value={v} defaultChecked={chosen.includes(v)} />
          {label(v)}
        </label>
      ))}
    </div>
  );
  const num = (key: string, value: number, min: number, max: number) => <input className="gcs-input" type="number" name={name(key)} defaultValue={value} min={min} max={max} required data-testid={`gcs-acp-${key}`} />;
  const toggle = (key: string, value: boolean, label: string) => (
    <label className="gcs-check">
      <input type="checkbox" name={name(key)} defaultChecked={value} data-testid={`gcs-acp-${key}`} />
      {label}
    </label>
  );

  const forms: Record<Exclude<Tab, "groups">, (opts: GcsClanOptions) => ReactNode> = {
    create: (v) => (
      <>
        {toggle(CLAN_SETTING.requireApproval, v.requireApproval, t("requireApproval"))}
        <Row label={t("maxPerMember")} hint={t("maxPerMemberHint")}>
          {num(CLAN_SETTING.maxPerMember, v.maxPerMember, 1, 10)}
        </Row>
        <Row label={t("leaveCooldown")} hint={t("leaveCooldownHint")}>
          {num(CLAN_SETTING.leaveCooldownHours, v.leaveCooldownHours, 0, 720)}
        </Row>
        <fieldset className="gcs-settingsFieldset" style={{ maxWidth: 520 }}>
          <legend>{t("requiredFields")}</legend>
          {checks(CLAN_SETTING.requiredFields, CLAN_REQUIRED_FIELDS, v.requiredFields, (f) => t(`fields.${f}`))}
        </fieldset>
        <Row label={t("logoMaxKb")}>{num(CLAN_SETTING.logoMaxKb, v.logoMaxKb, 16, 4096)}</Row>
        <Row label={t("bannerMaxKb")}>{num(CLAN_SETTING.bannerMaxKb, v.bannerMaxKb, 64, 8192)}</Row>
      </>
    ),
    tag: (v) => (
      <>
        <Row label={t("tagMin")}>{num(CLAN_SETTING.tagMin, v.tagMin, 1, 8)}</Row>
        <Row label={t("tagMax")}>{num(CLAN_SETTING.tagMax, v.tagMax, 1, 8)}</Row>
        <Row label={t("tagCharset")}>
          <select className="gcs-input" name={name(CLAN_SETTING.tagCharset)} defaultValue={v.tagCharset}>
            {GCS_TAG_CHARSETS.map((c) => (
              <option key={c} value={c}>
                {t(`charsets.${c}`)}
              </option>
            ))}
          </select>
        </Row>
      </>
    ),
    members: (v) => (
      <>
        <Row label={t("inviteDays")}>{num(CLAN_SETTING.inviteDays, v.inviteDays, 1, 60)}</Row>
        <Row label={t("requestDays")}>{num(CLAN_SETTING.requestDays, v.requestDays, 1, 60)}</Row>
        <Row label={t("archiveInactive")} hint={t("archiveInactiveHint")}>
          {num(CLAN_SETTING.archiveInactiveDays, v.archiveInactiveDays, 0, 730)}
        </Row>
        <fieldset className="gcs-settingsFieldset" style={{ maxWidth: 520 }}>
          <legend>{t("officerRights")}</legend>
          <p className="gcs-field__hint">{t("officerRightsHint")}</p>
          {checks(CLAN_SETTING.officerRights, CLAN_OFFICER_RIGHTS, v.officerRights, (r) => t(`rights.${r}`))}
        </fieldset>
      </>
    ),
    forum: (v) => (
      <>
        {!parentOk && v.forumMode !== "off" && (
          <p className="gcs-clanNotice" role="note" style={{ margin: 0, maxWidth: 520 }} data-testid="gcs-acp-clan-forum-warning">
            {t("forumParentMissing")}
          </p>
        )}
        <Row label={t("forumMode")}>
          <select className="gcs-input" name={name(CLAN_SETTING.forumMode)} defaultValue={v.forumMode} data-testid="gcs-acp-clans.forum_mode">
            {CLAN_FORUM_MODES.map((m) => (
              <option key={m} value={m}>
                {t(`forumModes.${m}`)}
              </option>
            ))}
          </select>
        </Row>
        <Row label={t("forumParent")} hint={t("forumParentHint")}>
          <select className="gcs-input" name={name(CLAN_SETTING.forumParent)} defaultValue={String(parentOk ? v.forumParent : 0)} data-testid="gcs-acp-clans.forum_parent">
            <option value="0">{t("forumParentNone")}</option>
            {forums.map((f) => (
              <option key={f.id} value={f.id}>
                {f.type === "CATEGORY" ? f.name : `— ${f.name}`}
              </option>
            ))}
          </select>
        </Row>
        <fieldset className="gcs-settingsFieldset" style={{ maxWidth: 520 }}>
          <legend>{t("forumStaff")}</legend>
          <p className="gcs-field__hint">{t("forumStaffHint")}</p>
          {checks(
            CLAN_SETTING.forumStaffGroups,
            groups.filter((g) => g.key !== "guest" && g.key !== "banned" && g.key !== "root_admin").map((g) => g.key),
            v.forumStaffGroups,
            (k) => groups.find((g) => g.key === k)?.name ?? k,
          )}
        </fieldset>
      </>
    ),
    ranking: (v) => (
      <>
        <p className="gcs-field__hint" style={{ maxWidth: 620, fontSize: 13 }}>
          {t("formula")}
        </p>
        <Row label={t("weightPosts")}>{num(CLAN_SETTING.weightPosts, v.weights.posts, 0, 100)}</Row>
        <Row label={t("weightReputation")}>{num(CLAN_SETTING.weightReputation, v.weights.reputation, 0, 100)}</Row>
        <Row label={t("weightActivity")}>{num(CLAN_SETTING.weightActivity, v.weights.activity, 0, 100)}</Row>
        <Row label={t("weightMembers")}>{num(CLAN_SETTING.weightMembers, v.weights.members, 0, 100)}</Row>
      </>
    ),
    display: (v) => (
      <>
        <fieldset className="gcs-settingsFieldset" style={{ maxWidth: 520 }}>
          <legend>{t("tagPlaces")}</legend>
          {checks(CLAN_SETTING.tagPlaces, CLAN_TAG_PLACES, v.tagPlaces, (p) => t(`places.${p}`))}
        </fieldset>
        {toggle(CLAN_SETTING.profileBadge, v.profileBadge, t("profileBadge"))}
      </>
    ),
  };

  // Valorile pe grup (cu cele implicite ale grupului, dacă nu au fost schimbate).
  const groupValues = await Promise.all(
    groups.map(async (g) => {
      const a = { userId: null, groupIds: [g.id], primaryGroupId: g.id, isBanned: false, ip: "" };
      const [create, join, moderate, max] = await Promise.all([
        permissions.groupValue<boolean>(a, "clans.create"),
        permissions.groupValue<boolean>(a, "clans.join"),
        permissions.groupValue<boolean>(a, "clans.moderate"),
        permissions.groupValue<number | boolean>(a, "clans.max_members"),
      ]);
      return { ...g, create: create === true, join: join === true, moderate: moderate === true, max: typeof max === "number" ? max : "" };
    }),
  );

  return (
    <>
      <GcsAcpTitle icon="fa-solid fa-sliders" description={t("lead")}>
        {t("title")}
      </GcsAcpTitle>
      <nav className="gcs-segLinks" aria-label={t("tabsLabel")} data-testid="gcs-acp-clan-settings-tabs">
        {TABS.map((k) => (
          <Link key={k} href={`/admin/gaming/clans/settings${k === "create" ? "" : `?tab=${k}`}`} className={`gcs-segLink${k === tab ? " gcs-segLink--active" : ""}`} aria-current={k === tab ? "page" : undefined}>
            {t(`tabs.${k}`)}
          </Link>
        ))}
      </nav>
      <GcsCard as="section" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }} aria-label={t(`tabs.${tab}`)}>
        <h2 className="gcs-acpWidget__title">
          <GcsAcpTitleIcon name={TAB_ICONS[tab]} />
          {t(`tabs.${tab}`)}
        </h2>
        {tab === "groups" ? (
          <>
            <p className="gcs-field__hint" style={{ fontSize: 13 }}>
              {canGroups ? t("groupsHint") : t("groupsNoRight")}
            </p>
            <GcsActionForm action={saveClanGroups} submitLabel={t("save")} submitKind="save">
              <div style={{ overflowX: "auto" }}>
                <table className="gcs-clanManage__table" data-testid="gcs-acp-clan-groups">
                  <thead>
                    <tr>
                      <th scope="col">{t("group")}</th>
                      <th scope="col">{t("canCreate")}</th>
                      <th scope="col">{t("canJoin")}</th>
                      <th scope="col">{t("maxMembers")}</th>
                      <th scope="col">{t("canModerate")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groupValues
                      .filter((g) => g.key !== "banned" && g.key !== "root_admin")
                      .map((g) => (
                        <tr key={g.id} data-group={g.key}>
                          <td>{g.name}</td>
                          <td>
                            <input type="checkbox" name={`clans.create:${g.id}`} defaultChecked={g.create} aria-label={`${t("canCreate")}: ${g.name}`} disabled={!canGroups} />
                          </td>
                          <td>
                            <input type="checkbox" name={`clans.join:${g.id}`} defaultChecked={g.join} aria-label={`${t("canJoin")}: ${g.name}`} disabled={!canGroups || g.key === "guest"} />
                          </td>
                          <td>
                            <input className="gcs-input" type="number" name={`clans.max_members:${g.id}`} defaultValue={g.max} min={-1} max={10000} style={{ width: 96 }} aria-label={`${t("maxMembers")}: ${g.name}`} disabled={!canGroups} />
                          </td>
                          <td>
                            <input type="checkbox" name={`clans.moderate:${g.id}`} defaultChecked={g.moderate} aria-label={`${t("canModerate")}: ${g.name}`} disabled={!canGroups || g.key === "guest"} />
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
              <p className="gcs-field__hint">{t("maxMembersHint")}</p>
            </GcsActionForm>
          </>
        ) : (
          <GcsActionForm action={save} submitLabel={t("save")} submitKind="save">
            {forms[tab](o)}
          </GcsActionForm>
        )}
        {tab === "ranking" && <GcsActionForm action={recomputeClanRanking} submitLabel={t("recompute")} submitKind="recompute" variant="ghost" compact />}
      </GcsCard>
    </>
  );
}
