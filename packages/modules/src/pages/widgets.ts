import type { GcsWidgetDef } from "@gcs/core";
import { widget } from "../widgets";

/**
 * Widget-urile aplicației Pagini (pe prima pagină, forum, topic și în constructor): înregistrările unei baze de date
 * (cele mai noi, recomandate, bine notate…) și un bloc reutilizabil.
 */
export const pagesWidgets: GcsWidgetDef[] = [
  widget({
    key: "pages.records",
    labelKey: "widgets.pages.records",
    descriptionKey: "widgets.desc.pages.records",
    icon: "fa-solid fa-database",
    defaultConfig: { database: "", sort: "newest", limit: 5 },
    fields: [
      { key: "database", labelKey: "widgets.fields.database", type: "select", optionsFrom: "pages.databases" },
      {
        key: "sort",
        labelKey: "widgets.fields.sort",
        type: "select",
        options: [
          { value: "newest", labelKey: "widgets.pagesSort.newest" },
          { value: "featured", labelKey: "widgets.pagesSort.featured" },
          { value: "rating", labelKey: "widgets.pagesSort.rating" },
          { value: "views", labelKey: "widgets.pagesSort.views" },
          { value: "comments", labelKey: "widgets.pagesSort.comments" },
          { value: "updated", labelKey: "widgets.pagesSort.updated" },
        ],
      },
      { key: "limit", labelKey: "widgets.fields.limit", type: "number", min: 1, max: 20 },
    ],
  }),
  widget({
    key: "pages.block",
    labelKey: "widgets.pages.block",
    descriptionKey: "widgets.desc.pages.block",
    icon: "fa-solid fa-cube",
    defaultConfig: { block: "" },
    fields: [{ key: "block", labelKey: "widgets.fields.block", type: "select", optionsFrom: "pages.blocks" }],
  }),
];
