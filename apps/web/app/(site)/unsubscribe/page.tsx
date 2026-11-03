import { GcsCard } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { services } from "@/lib/services";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("unsubscribe"))("title"), robots: { index: false } };
}

type Props = { searchParams: Promise<{ u?: string; t?: string }> };

/**
 * `/unsubscribe?u=<id>&t=<semnătură>`: linkul din josul fiecărui email în masă. Semnătura (HMAC cu secretul aplicației)
 * dovedește linkul, fără autentificare; membrul nu mai primește emailurile administratorilor și le poate porni din nou
 * din Setări → Email.
 */
export default async function UnsubscribePage({ searchParams }: Props) {
  const sp = await searchParams;
  const t = await getTranslations("unsubscribe");
  const ok = typeof sp.u === "string" && typeof sp.t === "string" && sp.u.length <= 40 && sp.t.length <= 64 && (await services().bulkMail.unsubscribe(sp.u, sp.t));
  return (
    <GcsCard as="section" className="gcs-contact" aria-labelledby="gcs-unsub-title" data-testid="gcs-unsubscribe" data-ok={ok ? "1" : "0"}>
      <h1 id="gcs-unsub-title" className="gcs-display gcs-pageHeader__title">
        <GcsIcon name={ok ? "fa-solid fa-envelope-circle-check" : "fa-solid fa-link-slash"} className="gcs-hIcon" />
        {ok ? t("done") : t("invalid")}
      </h1>
      <p className="gcs-muted" style={{ margin: 0 }}>
        {ok ? t("doneBody") : t("invalidBody")}
      </p>
      <p style={{ margin: 0 }}>
        <Link href="/settings/email">{t("settings")}</Link>
      </p>
    </GcsCard>
  );
}
