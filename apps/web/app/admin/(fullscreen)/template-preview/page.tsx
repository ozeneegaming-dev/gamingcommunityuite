import { TEMPLATES_ACP_SECTION } from "@gcs/core";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requireAcpSection } from "@/lib/acp";
import { GcsTemplatePreviewFrame } from "./GcsTemplatePreviewFrame";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acp.templatesEditor"))("previewTitle"), robots: { index: false, follow: false } };
}

/**
 * Previzualizarea editorului de șabloane (în `iframe`): o pagină goală cu stilurile site-ului și ale temei editate
 * (`?gcs-theme-preview=<cheie>`), în care editorul pune HTML-ul randat și sanitizat pe server. Aceeași gardă ca ACP.
 */
export default async function TemplatePreviewPage() {
  await requireAcpSection(TEMPLATES_ACP_SECTION);
  const t = await getTranslations("acp.templatesEditor");
  return <GcsTemplatePreviewFrame waiting={t("previewWaiting")} />;
}
