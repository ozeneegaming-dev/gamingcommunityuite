import type { Metadata } from "next";
import { GcsForumIndex } from "./_components/forum/GcsForumIndex";

export const metadata: Metadata = { alternates: { canonical: "/" } };

/**
 * Pagina principală: indexul forumului. Când aplicația de pornire e alta (ACP → Aplicații, ★), proxy-ul rescrie `/`
 * spre pagina ei, iar indexul forumului rămâne pe `/forum`.
 */
export default function HomePage() {
  return <GcsForumIndex />;
}
