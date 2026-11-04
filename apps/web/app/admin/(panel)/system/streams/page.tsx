import { faPlus, faSliders, faListUl } from "@fortawesome/free-solid-svg-icons";
import { GCS_STREAM_KINDS, loadStreamsConfig, STREAMS_ACP_SECTION, type GcsCustomStream } from "@gcs/modules";
import { GcsCard, GcsIconSvg } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { GcsIconInput } from "@/lib/ui-inputs";
import { services } from "@/lib/services";
import { GcsAcpEditPanel } from "../../_components/GcsAcpEditPanel";
import { GcsActionForm } from "../../_components/GcsActionForm";
import { GcsAcpTitle } from "../../_components/GcsAcpTitle";
import { GcsForumChecks } from "../../_components/GcsForumChecks";
import { forumGroups } from "../../_components/forum-groups";
import { deleteStream, moveStream, saveStream, saveStreamSettings } from "./actions";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.streams"))("title") };
}

/**
 * ACP › Sistem › Descoperire › Fluxuri: fluxul „Tot” de pe pagina Activitate (ce tipuri apar, forumurile excluse,
 * elementele pe pagină) și fluxurile proprii — tab-uri în plus (ex. „Știri”, „Servere”) cu tipurile și forumurile lor,
 * ca listă cu ordine și panoul fiecăruia.
 */
export default async function AcpStreamsPage() {
  const panel = await requireAcpSection(STREAMS_ACP_SECTION);
  const { settings, acp, db } = services();
  const [t, cfg, groups, canEdit, canDelete] = await Promise.all([
    getTranslations("acp.streams"),
    loadStreamsConfig(settings),
    forumGroups(db),
    acp.can(panel.actor, STREAMS_ACP_SECTION, "edit"),
    acp.can(panel.actor, STREAMS_ACP_SECTION, "delete"),
  ]);
  const forumName = new Map(groups.flatMap((g) => g.forums).map((f) => [f.id, f.name]));
  const kindChips = (kinds: readonly string[]) => (
    <span className="gcs-savedSteps">
      {kinds.map((k) => (
        <span key={k} className="gcs-sysChip">
          {t(`kinds.${k}`)}
        </span>
      ))}
    </span>
  );
  const kindChecks = (selected: readonly string[]) => (
    <fieldset className="gcs-formSec">
      <legend>{t("kindsTitle")}</legend>
      {GCS_STREAM_KINDS.map((k) => (
        <label key={k} className="gcs-toggleRow">
          <span>{t(`kinds.${k}`)}</span>
          <input type="checkbox" name={`kind:${k}`} defaultChecked={selected.includes(k)} />
        </label>
      ))}
    </fieldset>
  );
  const streamForm = (s?: GcsCustomStream) => (
    <GcsActionForm action={saveStream.bind(null, s?.key ?? null)} submitLabel={s ? t("save") : t("create")} submitKind={s ? "save" : "create"}>
      <fieldset className="gcs-formSec">
        <legend>{t("secStream")}</legend>
        <label className="gcs-field">
          {t("name")}
          <input className="gcs-input" name="name" required minLength={2} maxLength={40} defaultValue={s?.name ?? ""} />
        </label>
        <div className="gcs-field">
          <span>{t("icon")}</span>
          <GcsIconInput name="icon" value={s?.icon || null} testId="gcs-stream-icon" />
        </div>
      </fieldset>
      {kindChecks(s?.kinds ?? ["topic", "reply"])}
      <GcsForumChecks name="forumId" groups={groups} selected={s?.forumIds ?? []} legend={t("forums")} hint={t("forumsHint")} />
    </GcsActionForm>
  );

  return (
    <>
      <GcsAcpTitle
        icon="fa-solid fa-list-ul"
        description={t("description")}
        actions={
          canEdit && (
            <>
              <GcsAcpEditPanel label={t("settings")} buttonIcon={<GcsIconSvg icon={faSliders} />} title={t("settings")} titleIcon={<GcsIconSvg icon={faSliders} />} size="lg" testId="gcs-streams-settings">
                <GcsActionForm action={saveStreamSettings} submitLabel={t("save")} submitKind="save">
                  {kindChecks(cfg.kinds)}
                  <fieldset className="gcs-formSec">
                    <legend>{t("secPage")}</legend>
                    <label className="gcs-field">
                      {t("perPage")}
                      <input className="gcs-input" type="number" name="perPage" min={10} max={50} defaultValue={cfg.perPage} required />
                    </label>
                  </fieldset>
                  <GcsForumChecks name="excludeForumId" groups={groups} selected={cfg.excludeForumIds} legend={t("exclude")} hint={t("excludeHint")} />
                </GcsActionForm>
              </GcsAcpEditPanel>
              <GcsAcpEditPanel label={t("add")} variant="primary" buttonIcon={<GcsIconSvg icon={faPlus} />} title={t("add")} titleIcon={<GcsIconSvg icon={faListUl} />} size="lg" testId="gcs-stream-new">
                {streamForm()}
              </GcsAcpEditPanel>
            </>
          )
        }
      >
        {t("title")}
      </GcsAcpTitle>

      <GcsCard className="gcs-acpPanel">
        <ul className="gcs-sysList" data-testid="gcs-streams-list">
          <li className="gcs-sysList__row" data-stream="all">
            <span className="gcs-sysList__icon" aria-hidden="true">
              <GcsIcon name="fa-solid fa-bolt" />
            </span>
            <span className="gcs-sysList__body">
              <strong>
                <Link href="/activity">{t("allStream")}</Link>
              </strong>
              {kindChips(cfg.kinds)}
              <small>
                {cfg.excludeForumIds.length > 0 ? t("excluded", { forums: cfg.excludeForumIds.map((id) => forumName.get(id) ?? `#${id}`).join(", ") }) : t("noExcluded")} · {t("perPageChip", { n: cfg.perPage })}
              </small>
            </span>
            <span className="gcs-sysChip gcs-sysChip--ok">{t("builtIn")}</span>
          </li>
          {cfg.custom.map((s) => (
            <li key={s.key} className="gcs-sysList__row" data-testid="gcs-stream-row" data-stream={s.key}>
              <span className="gcs-sysList__icon" aria-hidden="true">
                <GcsIcon name={s.icon || "fa-solid fa-list-ul"} />
              </span>
              <span className="gcs-sysList__body">
                <strong>
                  <Link href={`/activity?stream=${s.key}`}>{s.name}</Link>
                </strong>
                {kindChips(s.kinds)}
                <small>{s.forumIds.length === 0 ? t("allForums") : t("inForums", { forums: s.forumIds.map((id) => forumName.get(id) ?? `#${id}`).join(", ") })}</small>
              </span>
              {canEdit && (
                <span className="gcs-streamMove">
                  <GcsActionForm action={moveStream.bind(null, s.key, -1)} submitLabel={t("up")} submitIcon={<GcsIcon name="fa-solid fa-arrow-up" />} variant="ghost" compact>
                    {null}
                  </GcsActionForm>
                  <GcsActionForm action={moveStream.bind(null, s.key, 1)} submitLabel={t("down")} submitIcon={<GcsIcon name="fa-solid fa-arrow-down" />} variant="ghost" compact>
                    {null}
                  </GcsActionForm>
                </span>
              )}
              {canEdit && (
                <GcsAcpEditPanel
                  title={s.name}
                  titleIcon={<GcsIconSvg icon={faListUl} />}
                  size="lg"
                  testId="gcs-stream-edit"
                  footer={
                    canDelete ? (
                      <GcsActionForm action={deleteStream.bind(null, s.key)} submitLabel={t("delete")} submitKind="delete" variant="ghost" compact confirm={t("confirmDelete")}>
                        {null}
                      </GcsActionForm>
                    ) : undefined
                  }
                >
                  {streamForm(s)}
                </GcsAcpEditPanel>
              )}
            </li>
          ))}
        </ul>
        {cfg.custom.length === 0 && <p className="gcs-sysHint" style={{ paddingBottom: 16 }}>{t("emptyCustom")}</p>}
      </GcsCard>
    </>
  );
}
