import { SAVED_ACTIONS_ACP_SECTION, type GcsSavedActionSteps } from "@gcs/modules";
import { GcsCard } from "@gcs/ui";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { services } from "@/lib/services";
import { GcsActionForm } from "../../_components/GcsActionForm";
import { deleteSavedAction, saveSavedAction } from "../../moderation-actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.savedActions"))("title") };
}

/** ACP → Comunitate → Acțiuni salvate: macro-urile de moderare (blochează, fixează, mută, răspuns predefinit). */
export default async function AcpSavedActionsPage() {
  await requireAcpSection(SAVED_ACTIONS_ACP_SECTION);
  const t = await getTranslations("acp.savedActions");
  const { moderation, db } = services();
  const [actions, forums] = await Promise.all([
    moderation.listActions(),
    db.forum.findMany({ where: { type: { in: ["FORUM", "QA"] } }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const forumName = new Map(forums.map((f) => [f.id, f.name]));
  const describe = (s: GcsSavedActionSteps) =>
    [
      s.lock && t("lock"),
      s.pin && t("pin"),
      s.feature && t("feature"),
      s.moveTo !== undefined && `${t("moveTo")} ${forumName.get(s.moveTo) ?? `#${s.moveTo}`}`,
      s.reply && `${t("reply")}: „${s.reply.slice(0, 60)}”`,
    ]
      .filter(Boolean)
      .join(" · ");

  return (
    <>
      <h1 className="gcs-display" style={{ margin: 0, fontSize: 28, fontWeight: 700 }}>
        {t("title")}
      </h1>
      {actions.length === 0 ? (
        <GcsCard style={{ padding: 16 }}>
          <p className="gcs-muted" style={{ margin: 0 }}>
            {t("empty")}
          </p>
        </GcsCard>
      ) : (
        actions.map((a) => (
          <GcsCard key={a.id} as="article" style={{ padding: 16, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <strong>{a.name}</strong>
              <p className="gcs-muted" style={{ margin: "4px 0 0", fontSize: 13 }}>
                {describe(a.actions as GcsSavedActionSteps)}
              </p>
            </div>
            <GcsActionForm action={deleteSavedAction.bind(null, a.id)} submitLabel={t("delete")} variant="ghost" compact />
          </GcsCard>
        ))
      )}
      <GcsCard as="section" aria-labelledby="gcs-saved-new" style={{ padding: 16, maxWidth: 720 }}>
        <h2 id="gcs-saved-new" className="gcs-acpWidget__title" style={{ marginBottom: 12 }}>
          {t("save")}
        </h2>
        <GcsActionForm action={saveSavedAction} submitLabel={t("save")}>
          <label className="gcs-field">
            {t("name")}
            <input className="gcs-input" name="name" required maxLength={60} />
          </label>
          <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", flexWrap: "wrap", gap: "4px 16px" }}>
            <legend style={{ marginBottom: 6 }}>{t("forums")}</legend>
            {forums.map((f) => (
              <label key={f.id} className="gcs-check">
                <input type="checkbox" name="forumId" value={f.id} />
                {f.name}
              </label>
            ))}
          </fieldset>
          <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", flexWrap: "wrap", gap: "4px 16px" }}>
            <legend style={{ marginBottom: 6 }}>{t("steps")}</legend>
            <label className="gcs-check">
              <input type="checkbox" name="lock" />
              {t("lock")}
            </label>
            <label className="gcs-check">
              <input type="checkbox" name="pin" />
              {t("pin")}
            </label>
            <label className="gcs-check">
              <input type="checkbox" name="feature" />
              {t("feature")}
            </label>
          </fieldset>
          <div className="gcs-field">
            <label htmlFor="gcs-saved-move">{t("moveTo")}</label>
            <select id="gcs-saved-move" className="gcs-input" name="moveTo" defaultValue="">
              <option value="">{t("noMove")}</option>
              {forums.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </div>
          <label className="gcs-field">
            {t("reply")}
            <textarea className="gcs-input" name="reply" rows={3} maxLength={2000} />
          </label>
        </GcsActionForm>
      </GcsCard>
    </>
  );
}
