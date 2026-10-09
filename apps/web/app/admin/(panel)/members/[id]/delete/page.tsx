import { MEMBER_REMOVAL_ACP_SECTION } from "@gcs/core";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { services } from "@/lib/services";
import { GcsAcpPageHeader } from "../../../_components/GcsAcpPageHeader";
import { GcsRemovalForm, GcsRemovalModeFields } from "../../_removal/GcsRemovalForm";
import { GcsRemovalItems, GcsRemovalNotes, GcsRemovalSection } from "../../_removal/GcsRemovalSummary";
import { deleteMember } from "../../removal-actions";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.removal"))("deleteTitle") };
}

/** ACP → Membri → un membru → „Șterge membrul” (specul 2026-10-09-stergere-unire-membri §2, §7). */
export default async function AcpMemberDeletePage({ params }: Props) {
  const panel = await requireAcpSection(MEMBER_REMOVAL_ACP_SECTION, "delete");
  const { id } = await params;
  const { memberRemoval } = services();
  const active = await memberRemoval.activeFor(id);
  if (active && active.status !== "SCHEDULED") redirect(`/admin/members/removals/${active.id}`);
  const preview = await memberRemoval.preview(panel.actor, id).catch(() => null);
  if (!preview) notFound();
  const [t, format, rootGroup] = await Promise.all([
    getTranslations("acp.removal"),
    getFormatter(),
    services().db.group.findUniqueOrThrow({ where: { key: "root_admin" }, select: { id: true } }),
  ]);
  // Regulile de siguranță (specul §3), arătate dinainte; serviciul le verifică oricum la confirmare.
  const self = panel.actor.userId === id;
  const blocked = self || (preview.user.isRoot && !panel.actor.groupIds.includes(rootGroup.id));

  return (
    <>
      <GcsAcpPageHeader
        icon="fa-solid fa-user-xmark"
        title={t("deleteTitle")}
        description={t("deleteLead", { name: preview.user.name })}
        breadcrumb={[{ label: t("crumbMembers"), href: "/admin/members" }, { label: preview.user.name, href: `/admin/members/${id}` }, { label: t("deleteTitle") }]}
        actions={
          <Link href={`/admin/members/${id}`} className="gcs-btn gcs-btn--ghost">
            <GcsIcon name="fa-solid fa-arrow-left" className="gcs-btn__icon" />
            {t("back")}
          </Link>
        }
      />
      {active?.status === "SCHEDULED" && (
        <p className="gcs-removalBanner" data-testid="gcs-removal-scheduled">
          <GcsIcon name="fa-solid fa-hourglass-half" />
          {t("scheduledSupersede", { date: format.dateTime(active.runAfter ?? new Date(), { dateStyle: "medium", timeStyle: "short" }) })}
        </p>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 420px), 1fr))", gap: 16, alignItems: "start" }}>
        <GcsRemovalSection title={t("hasTitle", { name: preview.user.name })} icon="fa-solid fa-box-archive" testId="gcs-removal-has">
          <GcsRemovalItems items={preview.items} empty={t("hasEmpty")} />
          <GcsRemovalNotes notes={preview.notes} />
        </GcsRemovalSection>
        <GcsRemovalSection title={t("confirmTitle")} icon="fa-solid fa-user-xmark" className="gcs-dangerZone" testId="gcs-removal-confirm">
          {blocked ? (
            <p className="gcs-removalNote gcs-removalNote--warn" style={{ margin: 0 }} data-testid="gcs-removal-blocked">
              <GcsIcon name="fa-solid fa-lock" />
              <span>{self ? t("blockedSelf") : t("blockedRoot")}</span>
            </p>
          ) : (
            <GcsRemovalForm
              action={deleteMember.bind(null, id)}
              kind="delete"
              testId="gcs-removal-delete-form"
              confirmLabel={t("confirmLabel", { name: preview.user.name })}
              submitLabel={t("deleteSubmit")}
              warning={t("deleteWarning")}
            >
              <GcsRemovalModeFields
                labels={{
                  legend: t("modeTitle"),
                  recommended: t("recommended"),
                  keepTitle: t("modes.KEEP_CONTENT.title"),
                  keepBody: t("modes.KEEP_CONTENT.body"),
                  deleteTitle: t("modes.DELETE_CONTENT.title"),
                  deleteBody: t("modes.DELETE_CONTENT.body"),
                  keepMessages: t("keepMessages"),
                  keepMessagesHint: t("keepMessagesHint"),
                }}
              />
            </GcsRemovalForm>
          )}
        </GcsRemovalSection>
      </div>
    </>
  );
}
