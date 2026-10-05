import type { GcsIndexCategory } from "@gcs/modules";
import Link from "next/link";
import { forumHref } from "@/lib/forum-urls";
import { GcsForumRow } from "./GcsForumRow";

/** O categorie cu forumurile ei (macheta Main). */
export function GcsCategoryCard({ category }: { category: GcsIndexCategory }) {
  return (
    <section className="gcs-card gcs-category" aria-labelledby={`gcs-cat-${category.id}`}>
      <header className="gcs-category__header">
        <span className="gcs-category__bar" style={{ background: category.color ?? "var(--gcs-accent)" }} aria-hidden="true" />
        <h2 id={`gcs-cat-${category.id}`} className="gcs-display gcs-category__title">
          <Link href={forumHref(category)}>{category.name}</Link>
        </h2>
      </header>
      {category.forums.map((f) => (
        <GcsForumRow key={f.id} forum={f} accent={category.color} />
      ))}
    </section>
  );
}
