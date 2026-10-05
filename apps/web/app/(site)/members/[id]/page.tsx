import { GcsAvatar, GcsCard } from "@gcs/ui";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { currentActor } from "@/lib/actor";
import { services } from "@/lib/services";

type Props = { params: Promise<{ id: string }> };

async function loadMember(id: string) {
  return services().db.user.findUnique({
    where: { id },
    select: { id: true, name: true, image: true, createdAt: true, lastActiveAt: true, primaryGroup: { select: { key: true, name: true, title: true } } },
  });
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const member = await loadMember((await params).id);
  return { title: member?.name };
}

/** Profilul minim din etapa 1: numele stilizat și grupul (profilul complet vine în etapa 3). */
export default async function MemberProfilePage({ params }: Props) {
  const actor = await currentActor();
  if (!(await services().permissions.can(actor, "core.view_public"))) notFound();
  const member = await loadMember((await params).id);
  if (!member) notFound();
  const t = await getTranslations("profile");
  const format = await getFormatter();

  return (
    <GcsCard as="section" style={{ padding: "28px 32px", display: "flex", gap: 24, alignItems: "center", flexWrap: "wrap" }}>
      <GcsAvatar name={member.name} size="l" {...(member.image ? { src: member.image } : {})} />
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <h1 className="gcs-display" style={{ margin: 0, fontSize: 32, fontWeight: 700 }}>
          <span className={`gcs-userLink gcs-name--${member.primaryGroup.key}`} data-testid="gcs-profile-name">
            {member.name}
          </span>
        </h1>
        <span style={{ color: "var(--gcs-muted)", fontSize: 14 }}>
          {t("group")}: {member.primaryGroup.title ?? member.primaryGroup.name}
        </span>
        <span style={{ color: "var(--gcs-muted)", fontSize: 14 }}>{t("memberSince", { date: format.dateTime(member.createdAt, { dateStyle: "long" }) })}</span>
      </div>
    </GcsCard>
  );
}
