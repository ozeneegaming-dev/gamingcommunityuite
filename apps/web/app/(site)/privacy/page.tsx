import type { Metadata } from "next";
import { GcsLegalDocPage, legalDocMetadata } from "../_components/GcsLegalDocPage";

export function generateMetadata(): Promise<Metadata> {
  return legalDocMetadata("privacy");
}

/** `/privacy`: politica de confidențialitate (ACP → Setări → Termeni și confidențialitate). */
export default function PrivacyPage() {
  return <GcsLegalDocPage kind="privacy" />;
}
