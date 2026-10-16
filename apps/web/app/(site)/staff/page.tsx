import { GcsError } from "@gcs/core";
import type { GcsStaffMember, GcsStaffSectionView } from "@gcs/modules";
import { GcsAvatar, GcsCard, GcsMemberName } from "@gcs/ui";
import { GcsIcon, isGcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { CSSProperties } from "react";
import { currentActor } from "@/lib/actor";
import { memberHref } from "@/lib/forum-urls";
import { GcsGroupLink } from "@/lib/group-pills";
import { GcsNamedHtml } from "@/lib/member-names";
import { services } from "@/lib/services";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("members"))("staffTitle") };
}

type T = Awaited<ReturnType<typeof getTranslations<"staffPage">>>;

/** Butoanele de contact: mesaj, profil și conturile / câmpurile de contact ale membrului (cu tooltip și etichetă). */
function Contacts({ m, t, viewerId }: { m: GcsStaffMember; t: T; viewerId: string | null }) {
  return (
    <div className="gcs-staffCard__contacts">
      {viewerId && viewerId !== m.id && (
        <Link href={`/messages/new?to=${encodeURIComponent(m.id)}`} className="gcs-btn gcs-btn--primary gcs-btn--sm" data-testid="gcs-staff-message">
          <GcsIcon name="fa-solid fa-envelope" className="gcs-btn__icon" />
          {t("message")}
        </Link>
      )}
      <Link href={memberHref(m)} className="gcs-btn gcs-btn--ghost gcs-btn--sm">
        <GcsIcon name="fa-solid fa-user" className="gcs-btn__icon" />
        {t("profile")}
      </Link>
      {m.contacts.map((c) => (
        <a key={c.kind} href={c.href} target="_blank" rel="noopener noreferrer nofollow" className="gcs-iconBtn gcs-staffCard__contact" aria-label={t("contactOn", { name: m.name, service: c.label })} title={c.label} data-kind={c.kind}>
          <GcsIcon name={isGcsIcon(c.icon) ? c.icon : "fa-solid fa-link"} />
        </a>
      ))}
    </div>
  );
}

function DetailedCard({ m, section, t, viewerId }: { m: GcsStaffMember; section: GcsStaffSectionView; t: T; viewerId: string | null }) {
  return (
    <article className="gcs-staffCard gcs-staffCard--detailed" data-testid="gcs-staff-card" data-layout="detailed">
      <div className="gcs-staffCard__head">
        <span className="gcs-staffCard__avatar">
          <GcsAvatar name={m.name} size="l" userId={m.id} className="gcs-staffCard__square" {...(m.image ? { src: m.image } : {})} />
          {m.online && <span className="gcs-postbit__online" role="img" aria-label={t("online")} title={t("online")} />}
        </span>
        <div className="gcs-staffCard__who">
          <strong className="gcs-staffCard__name">
            <GcsMemberName userId={m.id} name={m.name} nameKey={m.nameKey} href={memberHref(m)} />
          </strong>
          <GcsGroupLink groupId={section.groupId} size="sm" />
          {m.customTitle && <span className="gcs-staffCard__title">{m.customTitle}</span>}
        </div>
      </div>
      {m.descriptionHtml ? <GcsNamedHtml html={m.descriptionHtml} className="gcs-richText gcs-staffCard__desc" /> : <p className="gcs-staffCard__desc gcs-staffCard__desc--empty">{t("noDescription")}</p>}
      {m.duties.length > 0 && (
        <div className="gcs-staffCard__duties">
          <span className="gcs-staffCard__label">{t("duties")}</span>
          <ul>
            {m.duties.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        </div>
      )}
      <Contacts m={m} t={t} viewerId={viewerId} />
    </article>
  );
}

function CompactCard({ m, section, t }: { m: GcsStaffMember; section: GcsStaffSectionView; t: T }) {
  return (
    <article className="gcs-staffCard gcs-staffCard--compact" data-testid="gcs-staff-card" data-layout="compact">
      <span className="gcs-staffCard__avatar">
        <GcsAvatar name={m.name} size="m" userId={m.id} className="gcs-staffCard__square" {...(m.image ? { src: m.image } : {})} />
        {m.online && <span className="gcs-postbit__online" role="img" aria-label={t("online")} title={t("online")} />}
      </span>
      <span className="gcs-staffCard__who">
        <strong className="gcs-staffCard__name">
          <GcsMemberName userId={m.id} name={m.name} nameKey={m.nameKey} href={memberHref(m)} />
        </strong>
        <GcsGroupLink groupId={section.groupId} size="sm" />
      </span>
    </article>
  );
}

/**
 * `/staff` (Pagina Staff v2): secțiunile în ordinea din ACP, fiecare cu banda și titlul ei. Cardul detaliat (2 pe rând):
 * avatar pătrat rotunjit, numele stilizat și pastila grupului, descrierea, „Responsabilități” și butoanele de contact;
 * cardul compact pentru nivelurile de jos.
 */
export default async function StaffPage() {
  const t = await getTranslations("staffPage");
  const tm = await getTranslations("members");
  const actor = await currentActor();
  const sections = await services()
    .staffPage.sections(actor)
    .catch((error: unknown) => {
      if (error instanceof GcsError && error.status === 403) return null;
      throw error;
    });
  if (!sections) {
    return (
      <GcsCard style={{ padding: 24 }} role="alert" data-testid="gcs-members-forbidden">
        <GcsIcon name="fa-solid fa-lock" className="gcs-emptyIcon" />
        {tm("forbidden")}
      </GcsCard>
    );
  }
  return (
    <>
      <header className="gcs-pageHeader">
        <h1 className="gcs-display gcs-pageHeader__title">
          <GcsIcon name="fa-solid fa-shield-halved" className="gcs-hIcon" />
          {tm("staffTitle")}
        </h1>
        <p className="gcs-pageHeader__lead">{t("lead")}</p>
      </header>
      {sections.length === 0 && (
        <GcsCard style={{ padding: 24, color: "var(--gcs-muted)" }}>
          <GcsIcon name="fa-solid fa-user-slash" className="gcs-emptyIcon" />
          {tm("empty")}
        </GcsCard>
      )}
      {sections.map((s) => (
        <section key={s.groupId} className={`gcs-staffSection gcs-staffSection--${s.layout}`} aria-labelledby={`gcs-staff-${s.key}`} data-testid="gcs-staff-group" data-group={s.key} data-layout={s.layout}>
          <h2 id={`gcs-staff-${s.key}`} className="gcs-staffSection__band gcs-display" style={s.color ? ({ "--gcs-staff-c": s.color } as CSSProperties) : undefined}>
            <GcsGroupLink groupId={s.groupId} bare className="gcs-staffSection__link" data-testid="gcs-staff-group-link">
              <GcsIcon name={isGcsIcon(s.icon) ? s.icon : "fa-solid fa-user-shield"} /> <span data-testid="gcs-staff-section-title">{s.title}</span>
            </GcsGroupLink>
            <span className="gcs-staffSection__count">{t("count", { count: s.members.length })}</span>
          </h2>
          <div className="gcs-staffSection__grid">
            {s.members.map((m) => (s.layout === "compact" ? <CompactCard key={m.id} m={m} section={s} t={t} /> : <DetailedCard key={m.id} m={m} section={s} t={t} viewerId={actor.userId} />))}
          </div>
        </section>
      ))}
    </>
  );
}
