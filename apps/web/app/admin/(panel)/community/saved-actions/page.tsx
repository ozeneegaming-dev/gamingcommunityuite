import { faPlus, faWandMagicSparkles } from "@fortawesome/free-solid-svg-icons";
import { SAVED_ACTIONS_ACP_SECTION, type GcsSavedActionSteps } from "@gcs/modules";
import { GcsCard, GcsIconSvg } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { services } from "@/lib/services";
import { GcsAcpEditPanel } from "../../_components/GcsAcpEditPanel";
import { GcsActionForm } from "../../_components/GcsActionForm";
import { GcsAcpTitle } from "../../_components/GcsAcpTitle";
import { GcsForumChecks } from "../../_components/GcsForumChecks";
import { forumGroups } from "../../_components/forum-groups";
import { deleteSavedAction, saveSavedAction } from "../../moderation-actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.savedActions"))("title") };
}

/**
 * ACP → Comunitate → Acțiuni salvate: macro-urile de moderare (blochează, fixează, evidențiază, mută, răspuns
 * predefinit), ca listă cu pașii și forumurile fiecăreia; „Editează” și „Acțiune nouă” deschid panoul cu formularul
 * (forumurile grupate pe categorii), „Șterge” stă jos în panou.
 */
export default async function AcpSavedActionsPage() {
  const panel = await requireAcpSection(SAVED_ACTIONS_ACP_SECTION);
  const t = await getTranslations("acp.savedActions");
  const { moderation, db, acp } = services();
  const [actions, groups, canEdit, canDelete] = await Promise.all([
    moderation.listActions(),
    forumGroups(db),
    acp.can(panel.actor, SAVED_ACTIONS_ACP_SECTION, "edit"),
    acp.can(panel.actor, SAVED_ACTIONS_ACP_SECTION, "delete"),
  ]);
  const forumName = new Map(groups.flatMap((g) => g.forums).map((f) => [f.id, f.name]));
  const steps = (s: GcsSavedActionSteps) =>
    [
      s.lock && { icon: "fa-solid fa-lock", text: t("lock") },
      s.pin && { icon: "fa-solid fa-thumbtack", text: t("pin") },
      s.feature && { icon: "fa-solid fa-star", text: t("feature") },
      s.moveTo !== undefined && { icon: "fa-solid fa-right-to-bracket", text: `${t("moveTo")} ${forumName.get(s.moveTo) ?? `#${s.moveTo}`}` },
      s.reply && { icon: "fa-solid fa-reply", text: t("replyChip") },
    ].filter((x): x is { icon: string; text: string } => Boolean(x));

  const form = (a?: (typeof actions)[number]) => {
    const s = (a?.actions ?? {}) as GcsSavedActionSteps;
    return (
      <GcsActionForm action={saveSavedAction.bind(null, a?.id ?? null)} submitLabel={a ? t("saveChanges") : t("save")} submitKind={a ? "save" : "create"}>
        <fieldset className="gcs-formSec">
          <legend>{t("secBasics")}</legend>
          <label className="gcs-field">
            {t("name")}
            <input className="gcs-input" name="name" required maxLength={60} defaultValue={a?.name ?? ""} />
          </label>
        </fieldset>
        <fieldset className="gcs-formSec">
          <legend>{t("steps")}</legend>
          <label className="gcs-toggleRow">
            <span>{t("lock")}</span>
            <input type="checkbox" name="lock" defaultChecked={s.lock === true} />
          </label>
          <label className="gcs-toggleRow">
            <span>{t("pin")}</span>
            <input type="checkbox" name="pin" defaultChecked={s.pin === true} />
          </label>
          <label className="gcs-toggleRow">
            <span>{t("feature")}</span>
            <input type="checkbox" name="feature" defaultChecked={s.feature === true} />
          </label>
          <label className="gcs-field">
            {t("moveTo")}
            <select className="gcs-input" name="moveTo" defaultValue={s.moveTo !== undefined ? String(s.moveTo) : ""}>
              <option value="">{t("noMove")}</option>
              {groups.map((g, i) => (
                <optgroup key={i} label={g.category ?? t("noCategory")}>
                  {g.forums.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <label className="gcs-field">
            {t("reply")}
            <textarea className="gcs-input" name="reply" rows={4} maxLength={2000} defaultValue={s.reply ?? ""} />
          </label>
        </fieldset>
        <GcsForumChecks name="forumId" groups={groups} selected={(a?.forumIds as number[] | undefined) ?? []} legend={t("forumsTitle")} hint={t("forumsHint")} />
      </GcsActionForm>
    );
  };

  return (
    <>
      <GcsAcpTitle
        icon="fa-solid fa-wand-magic-sparkles"
        description={t("description")}
        actions={
          canEdit && (
            <GcsAcpEditPanel label={t("add")} variant="primary" buttonIcon={<GcsIconSvg icon={faPlus} />} title={t("add")} titleIcon={<GcsIconSvg icon={faPlus} />} size="lg" testId="gcs-saved-new">
              {form()}
            </GcsAcpEditPanel>
          )
        }
      >
        {t("title")}
      </GcsAcpTitle>
      <GcsCard className="gcs-acpPanel">
        {actions.length === 0 ? (
          <p className="gcs-acpList__empty gcs-sysEmpty">
            <GcsIcon name="fa-solid fa-wand-magic-sparkles" /> {t("empty")}
          </p>
        ) : (
          <ul className="gcs-sysList" data-testid="gcs-saved-list">
            {actions.map((a) => {
              const forums = (a.forumIds as number[]).map((id) => forumName.get(id) ?? `#${id}`);
              return (
                <li key={a.id} className="gcs-sysList__row" data-testid="gcs-saved-row" data-name={a.name}>
                  <span className="gcs-sysList__icon" aria-hidden="true">
                    <GcsIcon name="fa-solid fa-wand-magic-sparkles" />
                  </span>
                  <span className="gcs-sysList__body">
                    <strong>{a.name}</strong>
                    <span className="gcs-savedSteps">
                      {steps(a.actions as GcsSavedActionSteps).map((st, i) => (
                        <span key={i} className="gcs-sysChip">
                          <GcsIcon name={st.icon} />
                          {st.text}
                        </span>
                      ))}
                    </span>
                    <small>{forums.length === 0 ? t("allForums") : t("inForums", { forums: forums.join(", ") })}</small>
                  </span>
                  {canEdit && (
                    <GcsAcpEditPanel
                      title={a.name}
                      titleIcon={<GcsIconSvg icon={faWandMagicSparkles} />}
                      size="lg"
                      testId="gcs-saved-edit"
                      footer={
                        canDelete ? (
                          <GcsActionForm action={deleteSavedAction.bind(null, a.id)} submitLabel={t("delete")} submitKind="delete" variant="ghost" compact confirm={t("confirmDelete")}>
                            {null}
                          </GcsActionForm>
                        ) : undefined
                      }
                    >
                      {form(a)}
                    </GcsAcpEditPanel>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </GcsCard>
    </>
  );
}
