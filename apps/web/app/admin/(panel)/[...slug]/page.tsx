import { GcsButton, GcsCard } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireAcpPanel } from "@/lib/acp";
import { GcsAcpTitle } from "../_components/GcsAcpTitle";

type Props = { params: Promise<{ slug: string[] }> };

/** Intrarea din meniul ACP (spec §12.1) pentru o cale, dacă adminul o vede; altfel `null`. */
async function menuItem(slug: string[]) {
  const panel = await requireAcpPanel();
  const href = `/admin/${slug.join("/")}`;
  for (const section of panel.menu) {
    const item = section.items.find((i) => i.href === href);
    if (item) return item;
  }
  return null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const item = await menuItem((await params).slug);
  const t = await getTranslations();
  return { title: item && t.has(item.labelKey) ? t(item.labelKey) : undefined };
}

/**
 * Secțiunile din meniul ACP care vin în etapele următoare: o pagină „în curând”, ca meniul să aibă
 * structura completă din spec. O cale care nu e în meniul adminului → 404.
 */
export default async function AcpComingSoonPage({ params }: Props) {
  const item = await menuItem((await params).slug);
  if (!item) notFound();
  const t = await getTranslations();
  return (
    <>
      <GcsAcpTitle icon={item.icon}>{t.has(item.labelKey) ? t(item.labelKey) : item.key}</GcsAcpTitle>
      <GcsCard as="section" style={{ padding: "28px 32px", display: "flex", flexDirection: "column", gap: 12, alignItems: "flex-start" }}>
        <p style={{ margin: 0, color: "var(--gcs-muted)", fontSize: 15 }}>{t("acp.comingSoon.body")}</p>
        <GcsButton variant="ghost" asChild icon={<GcsIcon name="fa-solid fa-arrow-left" />}>
          <Link href="/admin">{t("acp.comingSoon.back")}</Link>
        </GcsButton>
      </GcsCard>
    </>
  );
}
