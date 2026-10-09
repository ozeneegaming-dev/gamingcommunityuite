import { MEMBER_REMOVAL_ACP_SECTION, normalizeUsername, type GcsMergePreview } from "@gcs/core";
import { GcsAvatar, GcsButton, GcsMemberName } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { services } from "@/lib/services";
import { GcsAcpPageHeader } from "../../../_components/GcsAcpPageHeader";
import { GcsRemovalForm } from "../../_removal/GcsRemovalForm";
import { GcsRemovalItems, GcsRemovalNotes, GcsRemovalSection } from "../../_removal/GcsRemovalSummary";
import { mergeMembers } from "../../removal-actions";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ target?: string }> };

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.removal"))("mergeTitle") };
}

/** Ținta după id, email exact sau nume exact; altfel `null` (și lista de rezultate ale căutării). */
async function resolveTarget(q: string, sourceId: string): Promise<string | null> {
  const { db } = services();
  const clean = q.trim();
  if (!clean) return null;
  const user =
    (await db.user.findUnique({ where: { id: clean }, select: { id: true } })) ??
    (await db.user.findUnique({ where: { email: clean.toLowerCase() }, select: { id: true } })) ??
    (await db.user.findUnique({ where: { nameNormalized: normalizeUsername(clean) }, select: { id: true } }));
  return user && user.id !== sourceId ? user.id : null;
}

const PROVIDERS: Record<string, string> = { credential: "fa-solid fa-key", discord: "fa-brands fa-discord", google: "fa-brands fa-google", steam: "fa-brands fa-steam" };

/** ACP → Membri → un membru → „Unește cu alt cont” (specul 2026-10-09-stergere-unire-membri §4, §7). */
export default async function AcpMemberMergePage({ params, searchParams }: Props) {
  const panel = await requireAcpSection(MEMBER_REMOVAL_ACP_SECTION, "delete");
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const { db, members, memberRemoval } = services();
  const source = await db.user.findUnique({ where: { id }, select: { id: true, name: true, email: true, image: true, primaryGroup: { select: { key: true, name: true } } } });
  if (!source) notFound();
  const active = await memberRemoval.activeFor(id);
  if (active && active.status !== "SCHEDULED") redirect(`/admin/members/removals/${active.id}`);
  const t = await getTranslations("acp.removal");
  const q = sp.target?.trim() ?? "";
  const targetId = q ? await resolveTarget(q, id) : null;
  const results = q && !targetId ? (await members.list({ q, page: 1 })).items.filter((m) => m.id !== id).slice(0, 10) : [];
  const preview: GcsMergePreview | null = targetId ? await memberRemoval.mergePreview(panel.actor, id, targetId).catch(() => null) : null;
  // Regulile de siguranță (specul §3), arătate dinainte; serviciul le verifică oricum la confirmare.
  const rootGroup = await db.group.findUniqueOrThrow({ where: { key: "root_admin" }, select: { id: true } });
  const blocked =
    panel.actor.userId === id
      ? "blockedSelfMerge"
      : preview && (preview.source.isRoot || preview.target.isRoot) && !panel.actor.groupIds.includes(rootGroup.id)
        ? "blockedRoot"
        : null;

  return (
    <>
      <GcsAcpPageHeader
        icon="fa-solid fa-code-merge"
        title={t("mergeTitle")}
        description={t("mergeLead", { name: source.name })}
        breadcrumb={[{ label: t("crumbMembers"), href: "/admin/members" }, { label: source.name, href: `/admin/members/${id}` }, { label: t("mergeTitle") }]}
        actions={
          <Link href={`/admin/members/${id}`} className="gcs-btn gcs-btn--ghost">
            <GcsIcon name="fa-solid fa-arrow-left" className="gcs-btn__icon" />
            {t("back")}
          </Link>
        }
      />

      <GcsRemovalSection title={t("merge.searchTitle")} icon="fa-solid fa-magnifying-glass" testId="gcs-merge-search">
        <form method="get" role="search" style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
          <label className="gcs-field" style={{ flex: "1 1 260px" }}>
            {t("merge.searchLabel")}
            <input className="gcs-input" type="search" name="target" defaultValue={q} placeholder={t("merge.searchPlaceholder")} required />
          </label>
          <GcsButton variant="primary" type="submit" icon={<GcsIcon name="fa-solid fa-magnifying-glass" />}>
            {t("merge.search")}
          </GcsButton>
        </form>
        <p style={{ margin: 0, color: "var(--gcs-muted)", fontSize: 13 }}>{t("merge.keeps")}</p>
        {q && !targetId && (
          <div data-testid="gcs-merge-results">
            {results.length === 0 ? (
              <p style={{ margin: 0, color: "var(--gcs-muted)", fontSize: 14 }}>{t("merge.noResults")}</p>
            ) : (
              <ul className="gcs-removalNotes">
                {results.map((m) => (
                  <li key={m.id} className="gcs-removalNote" style={{ alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
                    <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                      <GcsMemberName userId={m.id} name={m.name} nameKey={m.primaryGroup.key} href={`/admin/members/${m.id}`} />
                      <span style={{ color: "var(--gcs-muted)", fontSize: 12.5, overflowWrap: "anywhere" }}>
                        {m.email} · {m.primaryGroup.name}
                      </span>
                    </span>
                    <Link href={`/admin/members/${id}/merge?target=${encodeURIComponent(m.id)}`} className="gcs-btn gcs-btn--ghost gcs-btn--sm">
                      {t("merge.pick")}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </GcsRemovalSection>

      {preview && (
        <>
          <section className="gcs-mergePair" aria-label={t("merge.pairLabel")} data-testid="gcs-merge-pair">
            <MergeCard role={t("merge.source")} user={preview.source} kind="source" />
            <span className="gcs-mergePair__arrow" aria-hidden="true">
              <GcsIcon name="fa-solid fa-arrow-right" />
            </span>
            <MergeCard role={t("merge.target")} user={preview.target} kind="target" />
          </section>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <Link href={`/admin/members/${preview.target.id}/merge?target=${encodeURIComponent(preview.source.id)}`} className="gcs-btn gcs-btn--ghost gcs-btn--sm" data-testid="gcs-merge-swap">
              <GcsIcon name="fa-solid fa-right-left" className="gcs-btn__icon" />
              {t("merge.swap")}
            </Link>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 420px), 1fr))", gap: 16, alignItems: "start" }}>
            <GcsRemovalSection title={t("merge.movesTitle", { name: preview.source.name })} icon="fa-solid fa-truck-ramp-box" testId="gcs-merge-moves">
              <GcsRemovalItems items={preview.items} empty={t("hasEmpty")} />
              <span className="gcs-field">{t("merge.logins")}</span>
              {preview.logins.length === 0 ? (
                <p style={{ margin: 0, color: "var(--gcs-muted)", fontSize: 13 }}>{t("merge.noLogins")}</p>
              ) : (
                <ul className="gcs-removalNotes" data-testid="gcs-merge-logins">
                  {preview.logins.map((l) => (
                    <li key={l.providerId} className="gcs-removalNote" data-provider={l.providerId} data-action={l.action}>
                      <GcsIcon name={PROVIDERS[l.providerId] ?? "fa-solid fa-right-to-bracket"} />
                      <span>
                        <strong>{t.has(`merge.providers.${l.providerId}`) ? t(`merge.providers.${l.providerId}`) : l.providerId}</strong> ·{" "}
                        {l.providerId === "credential" ? t("merge.loginCredential") : l.action === "move" ? t("merge.loginMove") : t("merge.loginDrop")}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <GcsRemovalNotes notes={preview.notes} />
            </GcsRemovalSection>
            <GcsRemovalSection title={t("merge.confirmTitle")} icon="fa-solid fa-code-merge" className="gcs-dangerZone" testId="gcs-merge-confirm">
              {blocked ? (
                <p className="gcs-removalNote gcs-removalNote--warn" style={{ margin: 0 }} data-testid="gcs-removal-blocked">
                  <GcsIcon name="fa-solid fa-lock" />
                  <span>{t(blocked)}</span>
                </p>
              ) : (
                <GcsRemovalForm
                  action={mergeMembers.bind(null, preview.source.id, preview.target.id)}
                  kind="merge"
                  testId="gcs-merge-form"
                  confirmLabel={t("merge.confirmLabel", { name: preview.source.name })}
                  submitLabel={t("merge.submit")}
                  warning={t("merge.warning")}
                />
              )}
            </GcsRemovalSection>
          </div>
        </>
      )}
    </>
  );
}

function MergeCard({ role, user, kind }: { role: string; user: GcsMergePreview["source"]; kind: "source" | "target" }) {
  return (
    <div className={`gcs-mergeCard gcs-mergeCard--${kind}`} data-testid={`gcs-merge-${kind}`}>
      <GcsAvatar name={user.name} size="m" />
      <div className="gcs-mergeCard__body">
        <span className="gcs-mergeCard__role">{role}</span>
        {/* Fără stilul numelui grupului: culorile lui sunt alese pentru site și pot dispărea pe tema deschisă a ACP. */}
        <span className="gcs-mergeCard__name">{user.name}</span>
        <span className="gcs-mergeCard__meta">
          {user.groupName} · {user.email}
        </span>
      </div>
    </div>
  );
}
