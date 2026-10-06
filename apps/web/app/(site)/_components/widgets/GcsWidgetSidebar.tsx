"use client";

import { useDraggable } from "@dnd-kit/core";
import type { GcsWidgetZone } from "@gcs/core";
import { GcsIconSvg } from "@gcs/ui";
import { faCubes, faMagnifyingGlass, faPlus, faStar as faStarSolid } from "@fortawesome/free-solid-svg-icons";
import { faStar as faStarRegular } from "@fortawesome/free-regular-svg-icons";
import { useTranslations } from "next-intl";
import { useId, useMemo, useState, type ReactNode } from "react";
import type { GcsPageEditorWidget } from "./GcsPageEditor";

/** Ordinea zonelor în butoanele „Adaugă în zona:” (cum apar pe pagină). */
const ZONE_ORDER: GcsWidgetZone[] = ["top", "sidebar", "bottom"];

/** Id-ul dnd-kit al unui widget nou tras din listă (același widget poate apărea și la „Favorite”, și în categorie). */
export const newWidgetId = (section: string, key: string) => `new:${section}:${key}`;

/** Textul pentru căutare: fără diacritice și fără majuscule („Membri noi” se găsește și cu „membri”, „înregistrați” cu „inregistrati”). */
const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

type Props = {
  catalog: GcsPageEditorWidget[];
  favorites: string[];
  pageLabel: string;
  onToggleFavorite: (key: string) => void;
  onAdd: (zone: GcsWidgetZone, widget: GcsPageEditorWidget) => void;
  /** Subsolul: starea, acțiunile secundare și „Termină editarea”. */
  footer: ReactNode;
};

/**
 * Lista „Widget-uri disponibile” a modului „Editează pagina”, fixată în stânga: căutare live, „Favorite” (steluța
 * fiecărui widget) și widget-urile pe categorii (modulul lor), cu titlu și descriere. Un widget se trage pe pagină
 * (mouse / atingere) sau se adaugă din butonul „+” (tastatură), alegând zona.
 */
export function GcsWidgetSidebar({ catalog, favorites, pageLabel, onToggleFavorite, onAdd, footer }: Props) {
  const t = useTranslations("pageEditor");
  const titleId = useId();
  const favId = useId();
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState<string | null>(null);
  const q = fold(query.trim());

  const shown = useMemo(() => catalog.filter((w) => !q || fold(`${w.label} ${w.description}`).includes(q)), [catalog, q]);
  const favs = shown.filter((w) => favorites.includes(w.key));
  const categories = useMemo(() => {
    const out: { key: string; label: string; items: GcsPageEditorWidget[] }[] = [];
    for (const w of shown) {
      const c = out.find((x) => x.key === w.category) ?? out[out.push({ key: w.category, label: w.categoryLabel, items: [] }) - 1]!;
      c.items.push(w);
    }
    return out;
  }, [shown]);

  const card = (section: string, w: GcsPageEditorWidget) => {
    const id = newWidgetId(section, w.key);
    return (
      <WidgetCard
        key={id}
        id={id}
        widget={w}
        favorite={favorites.includes(w.key)}
        adding={adding === id}
        onToggleFavorite={() => onToggleFavorite(w.key)}
        onToggleAdding={() => setAdding(adding === id ? null : id)}
        onAdd={(zone) => {
          setAdding(null);
          onAdd(zone, w);
        }}
      />
    );
  };

  return (
    <aside className="gcs-pageSidebar" aria-labelledby={titleId} data-testid="gcs-widget-sidebar">
      <header className="gcs-pageSidebar__head">
        <h2 id={titleId} className="gcs-pageSidebar__title gcs-display">
          <GcsIconSvg icon={faCubes} />
          {t("catalog")}
        </h2>
        <p className="gcs-pageSidebar__page">{t("editing", { page: pageLabel })}</p>
        <label className="gcs-pageSidebar__search">
          <GcsIconSvg icon={faMagnifyingGlass} />
          <input
            type="search"
            className="gcs-input"
            placeholder={t("search")}
            aria-label={t("search")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            data-testid="gcs-widget-search"
          />
        </label>
      </header>

      <div className="gcs-pageSidebar__body">
        <p className="gcs-pageSidebar__hint">{t("dragHint")}</p>
        {(!q || favs.length > 0) && (
          <section className="gcs-pageSidebar__section" aria-labelledby={favId} data-testid="gcs-widget-favorites">
            <h3 id={favId} className="gcs-pageSidebar__heading">
              <GcsIconSvg icon={faStarSolid} className="gcs-pageSidebar__favIcon" />
              {t("favorites")}
            </h3>
            {favs.length > 0 ? <ul className="gcs-pageSidebar__list">{favs.map((w) => card("fav", w))}</ul> : <p className="gcs-pageSidebar__empty">{t("favoritesEmpty")}</p>}
          </section>
        )}
        {categories.map((c) => (
          <section key={c.key} className="gcs-pageSidebar__section" aria-label={c.label} data-category={c.key}>
            <h3 className="gcs-pageSidebar__heading">{c.label}</h3>
            <ul className="gcs-pageSidebar__list">{c.items.map((w) => card(c.key, w))}</ul>
          </section>
        ))}
        {shown.length === 0 && (
          <p role="status" className="gcs-pageSidebar__empty" data-testid="gcs-widget-search-empty">
            {t("noResults")}
          </p>
        )}
      </div>

      <footer className="gcs-pageSidebar__foot">{footer}</footer>
    </aside>
  );
}

type CardProps = {
  id: string;
  widget: GcsPageEditorWidget;
  favorite: boolean;
  adding: boolean;
  onToggleFavorite: () => void;
  onToggleAdding: () => void;
  onAdd: (zone: GcsWidgetZone) => void;
};

/**
 * Un widget din listă. Partea cu iconița și textul se trage pe pagină (doar cu indicatorul: din tastatură, „+” alege
 * zona); steluța îl pune la „Favorite”.
 */
function WidgetCard({ id, widget, favorite, adding, onToggleFavorite, onToggleAdding, onAdd }: CardProps) {
  const t = useTranslations("pageEditor");
  const { setNodeRef, listeners, isDragging } = useDraggable({ id, data: { newWidget: widget.key } });
  const zones = ZONE_ORDER.filter((z) => widget.zones.includes(z));
  return (
    <li className={`gcs-widgetCard${isDragging ? " gcs-widgetCard--dragging" : ""}`} data-widget-key={widget.key} data-testid="gcs-widget-card">
      <div className="gcs-widgetCard__row">
        <div ref={setNodeRef} className="gcs-widgetCard__drag" {...listeners}>
          <span className="gcs-widgetCard__icon">{widget.icon}</span>
          <span className="gcs-widgetCard__text">
            <strong>{widget.label}</strong>
            {widget.description && <small>{widget.description}</small>}
          </span>
        </div>
        <span className="gcs-widgetCard__tools">
          <button
            type="button"
            className={`gcs-widgetCard__btn gcs-widgetCard__star${favorite ? " gcs-widgetCard__star--on" : ""}`}
            onClick={onToggleFavorite}
            aria-pressed={favorite}
            aria-label={favorite ? t("unfavorite", { name: widget.label }) : t("favorite", { name: widget.label })}
            title={favorite ? t("unfavorite", { name: widget.label }) : t("favorite", { name: widget.label })}
            data-testid="gcs-widget-favorite"
          >
            <GcsIconSvg icon={favorite ? faStarSolid : faStarRegular} />
          </button>
          <button
            type="button"
            className="gcs-widgetCard__btn"
            onClick={onToggleAdding}
            aria-expanded={adding}
            aria-label={t("addWidget", { name: widget.label })}
            title={t("addWidget", { name: widget.label })}
            data-testid="gcs-widget-card-add"
          >
            <GcsIconSvg icon={faPlus} />
          </button>
        </span>
      </div>
      {adding && (
        <div className="gcs-widgetCard__zones" role="group" aria-label={t("addTo")}>
          <span aria-hidden="true">{t("addTo")}</span>
          {zones.map((z) => (
            <button key={z} type="button" className="gcs-widgetCard__zone" onClick={() => onAdd(z)} data-testid={`gcs-widget-card-add-${z}`}>
              {t(`zones.${z}`)}
            </button>
          ))}
        </div>
      )}
    </li>
  );
}
