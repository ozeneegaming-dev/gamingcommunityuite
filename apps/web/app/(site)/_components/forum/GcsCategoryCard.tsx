import type { GcsIndexCategory } from "@gcs/modules";
import { GcsIcon, isGcsIcon } from "@gcs/ui/icons";
import Link from "next/link";
import { forumHref } from "@/lib/forum-urls";
import { GcsForumRow } from "./GcsForumRow";

/** Iconița implicită a unei categorii fără iconiță aleasă în ACP. */
const DEFAULT_CATEGORY_ICON = "fa-solid fa-folder-open";

/** O categorie cu forumurile ei (macheta Main): bara de culoare, iconița categoriei într-un pătrat de accent și titlul. */
export function GcsCategoryCard({ category }: { category: GcsIndexCategory }) {
  const icon = isGcsIcon(category.icon) ? category.icon : DEFAULT_CATEGORY_ICON;
  return (
    <section className="gcs-card gcs-category" aria-labelledby={`gcs-cat-${category.id}`}>
      <header className="gcs-category__header">
        <span className="gcs-category__bar" style={{ background: category.color ?? "var(--gcs-accent)" }} aria-hidden="true" />
        <span
          className="gcs-category__icon"
          style={category.color ? { color: category.color } : undefined}
          aria-hidden="true"
          data-icon={icon}
          data-testid="gcs-category-icon"
        >
          <GcsIcon name={icon} />
        </span>
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
