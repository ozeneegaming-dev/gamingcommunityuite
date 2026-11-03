import { GcsCard } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { currentActor } from "@/lib/actor";
import { services } from "@/lib/services";
import { GcsContactForm } from "./GcsContactForm";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("contact"))("title") };
}

/**
 * `/contact`: formularul de contact (ACP › Setări › Contact). Oprit → 404; cu o adresă externă → acolo. Membrii trimit
 * cu numele și emailul contului; vizitatorii (dacă au voie) completează ale lor și trec prin captcha-ul invizibil.
 */
export default async function ContactPage() {
  const { contact, db, antispam } = services();
  const [t, actor, cfg, captcha] = await Promise.all([getTranslations("contact"), currentActor(), contact.config(), antispam.captchaMode()]);
  if (!cfg.enabled) notFound();
  if (cfg.redirectUrl) redirect(cfg.redirectUrl);
  const account = actor.userId ? await db.user.findUnique({ where: { id: actor.userId }, select: { name: true, email: true } }) : null;

  return (
    <GcsCard as="section" className="gcs-contact" aria-labelledby="gcs-contact-title" data-testid="gcs-contact">
      <header className="gcs-contact__head">
        <h1 id="gcs-contact-title" className="gcs-display gcs-pageHeader__title">
          <GcsIcon name="fa-solid fa-envelope-open-text" className="gcs-hIcon" />
          {t("title")}
        </h1>
        <p className="gcs-muted gcs-contact__intro">{cfg.intro || t("intro")}</p>
      </header>
      {!account && !cfg.guests ? (
        <p className="gcs-contact__login" data-testid="gcs-contact-login">
          <GcsIcon name="fa-solid fa-right-to-bracket" /> {t("loginRequired")} <Link href="/login?next=/contact">{t("login")}</Link>
        </p>
      ) : (
        <GcsContactForm subjects={cfg.subjects} member={account ? { name: account.name, email: account.email.endsWith(".invalid") ? null : account.email } : null} pow={!account && captcha !== "none"} />
      )}
    </GcsCard>
  );
}
