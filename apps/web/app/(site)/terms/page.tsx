import type { Metadata } from "next";
import { GcsLegalDocPage, legalDocMetadata } from "../_components/GcsLegalDocPage";

export function generateMetadata(): Promise<Metadata> {
  return legalDocMetadata("terms");
}

/** `/terms`: termenii de utilizare (ACP → Setări → Termeni și confidențialitate). */
export default function TermsPage() {
  return <GcsLegalDocPage kind="terms" />;
}
