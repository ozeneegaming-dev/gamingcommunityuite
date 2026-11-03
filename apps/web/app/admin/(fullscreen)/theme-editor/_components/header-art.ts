import headerArena from "@/app/_art/header-arena.jpg";
import headerForja from "@/app/_art/header-forja.jpg";

/** Miniaturile imaginilor de antet incluse în GCS (`header.art`), pentru alegerea lor în editorul vizual. */
export const HEADER_ART_THUMBS: Readonly<Record<string, string>> = { forja: headerForja.src, arena: headerArena.src };
