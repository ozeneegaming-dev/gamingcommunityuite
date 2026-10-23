import { ARCHIVE_ACP_SECTION, type GcsArchiveRuleView } from "@gcs/modules";
import { GcsBadge, GcsCard } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { services } from "@/lib/services";
import { GcsActionForm } from "../../_components/GcsActionForm";
import { GcsAcpTitle } from "../../_components/GcsAcpTitle";
import { deleteArchiveRule, runArchiveRule, saveArchiveRule } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.archive"))("title") };
}

type Props = { searchParams: Promise<{ edit?: string }> };

const EMPTY: GcsArchiveRuleView = {
  id: 0,
  name: "",
  enabled: true,
  lastRunAt: null,
  lastCount: 0,
  conditions: { lastPostDays: 365, forumIds: [], pinned: "no", locked: "any", hidden: "any", poll: "any", repliesBelow: null, viewsBelow: null, ratingBelow: null, starterIds: [] },
  exclusions: { forumIds: [], pinned: true, locked: false, poll: false, repliesAtLeast: null, viewsAtLeast: null, ratingAtLeast: null, starterIds: [] },
};

/**
 * ACP → Comunitate → Forumuri → Arhivare (Forum v2): regulile arhivării automate (condițiile și excepțiile „dar nu
 * când”), câte topicuri ar arhiva fiecare acum, „Rulează acum” și comutatorul general din setările forumului.
 */
export default async function AcpArchivePage({ searchParams }: Props) {
  const panel = await requireAcpSection(ARCHIVE_ACP_SECTION);
  const t = await getTranslations("acp.archive");
  const format = await getFormatter();
  const { archive, db, settings } = services();
  const [rules, forums, enabled] = await Promise.all([
    archive.list(panel.actor),
    db.forum.findMany({ where: { type: { in: ["FORUM", "QA", "PAGE"] } }, orderBy: [{ parentId: "asc" }, { position: "asc" }], select: { id: true, name: true } }),
    settings.get<boolean>("forums.archive_enabled"),
  ]);
  const counts = await Promise.all(rules.map((r) => archive.preview(panel.actor, r)));
  const sp = await searchParams;
  const editing = sp.edit === "new" ? EMPTY : rules.find((r) => String(r.id) === sp.edit) ?? null;
  const starterNames = async (ids: string[]) => (ids.length ? (await db.user.findMany({ where: { id: { in: ids } }, select: { name: true } })).map((u) => u.name).join(", ") : "");

  return (
    <>
      <GcsAcpTitle icon="fa-solid fa-box-archive" description={t("description")}>
        {t("title")}
      </GcsAcpTitle>
      <p className={enabled ? "gcs-notice" : "gcs-notice gcs-notice--warn"} data-testid="gcs-archive-switch">
        <GcsIcon name={enabled ? "fa-solid fa-circle-check" : "fa-solid fa-circle-pause"} />
        {enabled ? t("enabled") : t("disabled")} <Link href="/admin/settings/posting">{t("settingsLink")}</Link>
      </p>

      <GcsCard as="section" aria-labelledby="gcs-archive-rules" style={{ padding: 16 }}>
        <div className="gcs-acpWidget__header">
          <h2 id="gcs-archive-rules" className="gcs-acpWidget__title">
            {t("rules")}
          </h2>
          <Link href="/admin/community/archive?edit=new" className="gcs-btn gcs-btn--primary gcs-btn--sm" data-testid="gcs-archive-new">
            <GcsIcon name="fa-solid fa-plus" className="gcs-btn__icon" />
            {t("new")}
          </Link>
        </div>
        {rules.length === 0 ? (
          <p className="gcs-muted">{t("empty")}</p>
        ) : (
          <ul className="gcs-archiveRules" data-testid="gcs-archive-list">
            {rules.map((r, i) => (
              <li key={r.id} className="gcs-archiveRule" data-testid="gcs-archive-rule">
                <div className="gcs-archiveRule__main">
                  <strong>{r.name}</strong>
                  <GcsBadge tone={r.enabled ? "ok" : "neutral"}>{r.enabled ? t("on") : t("off")}</GcsBadge>
                  <span className="gcs-muted">{t("summary", { days: r.conditions.lastPostDays, count: counts[i] ?? 0 })}</span>
                  {r.lastRunAt && <span className="gcs-muted">{t("lastRun", { date: format.dateTime(new Date(r.lastRunAt), { dateStyle: "medium", timeStyle: "short" }), count: r.lastCount })}</span>}
                </div>
                <div className="gcs-archiveRule__actions">
                  <Link href={`/admin/community/archive?edit=${r.id}`} className="gcs-btn gcs-btn--ghost gcs-btn--sm">
                    <GcsIcon name="fa-solid fa-pen" className="gcs-btn__icon" />
                    {t("edit")}
                  </Link>
                  <GcsActionForm compact variant="ghost" action={runArchiveRule.bind(null, r.id)} submitLabel={t("runNow")} submitKind="recompute" confirm={t("runConfirm", { count: counts[i] ?? 0 })} />
                  <GcsActionForm compact variant="ghost" action={deleteArchiveRule.bind(null, r.id)} submitLabel={t("delete")} submitKind="delete" confirm={t("deleteConfirm")} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </GcsCard>

      {editing && (
        <GcsCard as="section" aria-labelledby="gcs-archive-form" style={{ padding: 16, maxWidth: 820 }} data-testid="gcs-archive-form">
          <h2 id="gcs-archive-form" className="gcs-acpWidget__title" style={{ marginBottom: 12 }}>
            {editing.id ? t("editTitle", { name: editing.name }) : t("new")}
          </h2>
          <GcsActionForm action={saveArchiveRule.bind(null, editing.id || null)} submitLabel={t("save")} submitKind="save" redirectTo="/admin/community/archive">
            <label className="gcs-field">
              {t("name")}
              <input className="gcs-input" name="name" required maxLength={80} defaultValue={editing.name} />
            </label>
            <label className="gcs-check">
              <input type="checkbox" name="enabled" defaultChecked={editing.enabled} />
              {t("ruleEnabled")}
            </label>

            <fieldset className="gcs-acpFieldset">
              <legend>{t("conditions")}</legend>
              <label className="gcs-field">
                {t("lastPostDays")}
                <input className="gcs-input" name="lastPostDays" type="number" min={1} max={36500} required defaultValue={editing.conditions.lastPostDays} />
              </label>
              <ForumChecks name="forumIds" forums={forums} selected={editing.conditions.forumIds} legend={t("forums")} hint={t("forumsHint")} />
              <div className="gcs-archiveGrid">
                {(["pinned", "locked", "hidden", "poll"] as const).map((k) => (
                  <label key={k} className="gcs-field">
                    {t(`flags.${k}`)}
                    <select className="gcs-input" name={k} defaultValue={editing.conditions[k]}>
                      {(["any", "yes", "no"] as const).map((v) => (
                        <option key={v} value={v}>
                          {t(`tri.${v}`)}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              <div className="gcs-archiveGrid">
                <label className="gcs-field">
                  {t("repliesBelow")}
                  <input className="gcs-input" name="repliesBelow" type="number" min={1} defaultValue={editing.conditions.repliesBelow ?? ""} />
                </label>
                <label className="gcs-field">
                  {t("viewsBelow")}
                  <input className="gcs-input" name="viewsBelow" type="number" min={1} defaultValue={editing.conditions.viewsBelow ?? ""} />
                </label>
                <label className="gcs-field">
                  {t("ratingBelow")}
                  <input className="gcs-input" name="ratingBelow" inputMode="decimal" defaultValue={editing.conditions.ratingBelow ?? ""} />
                </label>
              </div>
              <label className="gcs-field">
                {t("starters")}
                <input className="gcs-input" name="starters" defaultValue={await starterNames(editing.conditions.starterIds)} placeholder={t("startersHint")} />
              </label>
            </fieldset>

            <fieldset className="gcs-acpFieldset">
              <legend>{t("exclusions")}</legend>
              <ForumChecks name="notForumIds" forums={forums} selected={editing.exclusions.forumIds} legend={t("forums")} />
              <label className="gcs-check">
                <input type="checkbox" name="notPinned" defaultChecked={editing.exclusions.pinned} />
                {t("not.pinned")}
              </label>
              <label className="gcs-check">
                <input type="checkbox" name="notLocked" defaultChecked={editing.exclusions.locked} />
                {t("not.locked")}
              </label>
              <label className="gcs-check">
                <input type="checkbox" name="notPoll" defaultChecked={editing.exclusions.poll} />
                {t("not.poll")}
              </label>
              <div className="gcs-archiveGrid">
                <label className="gcs-field">
                  {t("not.repliesAtLeast")}
                  <input className="gcs-input" name="notRepliesAtLeast" type="number" min={1} defaultValue={editing.exclusions.repliesAtLeast ?? ""} />
                </label>
                <label className="gcs-field">
                  {t("not.viewsAtLeast")}
                  <input className="gcs-input" name="notViewsAtLeast" type="number" min={1} defaultValue={editing.exclusions.viewsAtLeast ?? ""} />
                </label>
                <label className="gcs-field">
                  {t("not.ratingAtLeast")}
                  <input className="gcs-input" name="notRatingAtLeast" inputMode="decimal" defaultValue={editing.exclusions.ratingAtLeast ?? ""} />
                </label>
              </div>
              <label className="gcs-field">
                {t("not.starters")}
                <input className="gcs-input" name="notStarters" defaultValue={await starterNames(editing.exclusions.starterIds)} placeholder={t("startersHint")} />
              </label>
            </fieldset>
          </GcsActionForm>
        </GcsCard>
      )}
    </>
  );
}

function ForumChecks({ name, forums, selected, legend, hint }: { name: string; forums: { id: number; name: string }[]; selected: number[]; legend: string; hint?: string }) {
  const set = new Set(selected);
  return (
    <fieldset className="gcs-acpFieldset gcs-archiveForums">
      <legend>{legend}</legend>
      {hint && <p className="gcs-muted gcs-acpHint">{hint}</p>}
      <div className="gcs-archiveForums__list">
        {forums.map((f) => (
          <label key={f.id} className="gcs-check">
            <input type="checkbox" name={name} value={f.id} defaultChecked={set.has(f.id)} />
            {f.name}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
