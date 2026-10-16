/**
 * Modelul legendei Grupuri Pro, fără dependențe de server (îl folosesc serviciul, pagina ACP „Legenda grupurilor” și
 * previzualizarea ei live din browser): categoriile, opțiunile de afișare, locul fiecărui grup (categoria, grupul
 * părinte, poziția), operațiile editorului (adaugă / redenumește / reordonează / ascunde / șterge categorii, mută grupuri
 * între categorii și sub alt grup) și construirea legendei din locuri și numărători.
 */

/** O categorie a legendei: cheia, eticheta (`""` = eticheta implicită tradusă), iconița și dacă e ascunsă. */
export type GcsLegendCategory = { key: string; label: string; icon?: string; hidden?: boolean };

/** Categoriile implicite (etichetele traduse: `groupsPro.category.<cheie>`). */
export const DEFAULT_LEGEND_CATEGORIES: readonly GcsLegendCategory[] = [
  { key: "staff", label: "", icon: "fa-solid fa-shield-halved" },
  { key: "moderators", label: "", icon: "fa-solid fa-user-shield" },
  { key: "vip", label: "", icon: "fa-solid fa-crown" },
  { key: "members", label: "", icon: "fa-solid fa-users" },
];
export const LEGEND_CATEGORY_MAX = 12;
export const LEGEND_LABEL_MAX = 32;
const CATEGORY_KEY_RE = /^[a-z0-9_]{1,24}$/;
/** O iconiță Font Awesome după nume (`fa-solid fa-users`); registrul o validează la randare. */
const ICON_RE = /^fa-(solid|regular|brands) fa-[a-z0-9-]{1,48}$/;

export const isLegendIcon = (v: unknown): v is string => typeof v === "string" && ICON_RE.test(v);

/** Validarea listei de categorii: 1–12, chei unice `[a-z0-9_]`, etichete scurte, iconița și „ascunsă” opționale. */
export function validLegendCategories(v: unknown): v is GcsLegendCategory[] {
  if (!Array.isArray(v) || v.length === 0 || v.length > LEGEND_CATEGORY_MAX) return false;
  const keys = new Set<string>();
  for (const c of v) {
    if (typeof c !== "object" || c === null) return false;
    const { key, label, icon, hidden } = c as Record<string, unknown>;
    if (typeof key !== "string" || !CATEGORY_KEY_RE.test(key) || keys.has(key)) return false;
    if (typeof label !== "string" || label.length > LEGEND_LABEL_MAX) return false;
    if (icon !== undefined && !isLegendIcon(icon)) return false;
    if (hidden !== undefined && typeof hidden !== "boolean") return false;
    keys.add(key);
  }
  return true;
}

/** Opțiunile de afișare ale legendei (setarea `groups_pro.legend_display`). */
export type GcsLegendDisplay = {
  /** Cardurile categoriilor pe rând (pe ecran lat). */
  columns: 2 | 3 | 4;
  /** Numărul de membri pe fiecare rând. */
  memberCounts: boolean;
  /** Câți sunt online pe fiecare rând. */
  onlineCounts: boolean;
  /** Numărătorile includ membrii care au grupul ca secundar. */
  countSecondary: boolean;
  /** Grupurile fără membri (după numărătoare) lipsesc. */
  hideEmpty: boolean;
  /** Butonul „Vezi toate grupurile”. */
  seeAll: boolean;
  /** Pagina `/members/groups` („Grupurile comunității”). */
  groupsPage: boolean;
};

export const DEFAULT_LEGEND_DISPLAY: GcsLegendDisplay = {
  columns: 3,
  memberCounts: true,
  onlineCounts: true,
  countSecondary: true,
  hideEmpty: false,
  seeAll: true,
  groupsPage: true,
};

const DISPLAY_FLAGS = ["memberCounts", "onlineCounts", "countSecondary", "hideEmpty", "seeAll", "groupsPage"] as const;

/** O valoare completă și corectă pentru `groups_pro.legend_display`. */
export function validLegendDisplay(v: unknown): v is GcsLegendDisplay {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  if (Object.keys(o).some((k) => k !== "columns" && !(DISPLAY_FLAGS as readonly string[]).includes(k))) return false;
  return (o.columns === 2 || o.columns === 3 || o.columns === 4) && DISPLAY_FLAGS.every((k) => typeof o[k] === "boolean");
}

/** Opțiunile salvate, completate cu cele implicite (o valoare veche sau stricată nu strică legenda). */
export function legendDisplay(v: unknown): GcsLegendDisplay {
  const o = typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  const out: GcsLegendDisplay = { ...DEFAULT_LEGEND_DISPLAY };
  if (o.columns === 2 || o.columns === 3 || o.columns === 4) out.columns = o.columns;
  for (const k of DISPLAY_FLAGS) if (typeof o[k] === "boolean") out[k] = o[k];
  return out;
}

// ─── Locurile grupurilor ───────────────────────────────────────────────────────────────────────────────────────────

/** Numărătorile unui grup (ca în `GcsGroupDirectory.counts()`). */
export type GcsLegendCount = { members: number; secondary: number; online: number; onlineSecondary: number };

/** Locul unui grup în legendă: categoria (`""` = nu apare), grupul sub care apare și poziția (ordinea din editor). */
export type GcsGroupLegendPlace = { category: string; parentId: number | null; position?: number | null };

/** Ce știe legenda despre un grup (datele pastilei, ordinea implicită și numărătorile). */
export type GcsLegendSourceGroup = {
  id: number;
  key: string;
  name: string;
  color: string | null;
  icon: string | null;
  public: boolean;
  description: string;
  inLegend: boolean;
  priority: number;
  position: number;
};

/** Ordinea implicită: „Prioritate afișare”, apoi ordinea grupurilor din ACP. */
const byPriority = (a: Pick<GcsLegendSourceGroup, "priority" | "position" | "id">, b: Pick<GcsLegendSourceGroup, "priority" | "position" | "id">) =>
  b.priority - a.priority || a.position - b.position || a.id - b.id;

type Pill = Pick<GcsLegendSourceGroup, "id" | "key" | "name" | "color" | "icon" | "public" | "description">;
/** Un grup în legenda Pro: datele pastilei, numărătorile (după opțiuni) și grupurile legate de el (dropdown-ul). */
export type GcsLegendProGroup = Pill & {
  count: GcsLegendCount;
  children: (Pill & { count: GcsLegendCount })[];
  /** Membrii grupurilor legate, adunați (antetul dropdown-ului). */
  childMembers: number;
};
export type GcsLegendProCategory = GcsLegendCategory & { members: number; groups: GcsLegendProGroup[] };

const ZERO: GcsLegendCount = { members: 0, secondary: 0, online: 0, onlineSecondary: 0 };

/** Numărătorile afișate: fără membrii secundari, dacă așa cere opțiunea. */
export function displayedCount(c: GcsLegendCount | undefined, display: Pick<GcsLegendDisplay, "countSecondary">): GcsLegendCount {
  const n = c ?? ZERO;
  if (display.countSecondary) return n;
  return { members: Math.max(0, n.members - n.secondary), secondary: 0, online: Math.max(0, n.online - n.onlineSecondary), onlineSecondary: 0 };
}

/**
 * Legenda pe categorii: categoriile vizibile, în ordine; grupurile „în legendă” cu o categorie existentă, după poziția
 * din editor (apoi „Prioritate afișare”); un grup cu un părinte valid (în aceeași categorie, el însuși fără părinte)
 * apare în dropdown-ul părintelui. Cu „ascunde grupurile goale”, grupurile fără membri lipsesc (un părinte gol rămâne
 * dacă are grupuri legate cu membri). Categoriile goale lipsesc.
 */
export function buildLegend(input: {
  categories: readonly GcsLegendCategory[];
  places: ReadonlyMap<number, GcsGroupLegendPlace>;
  groups: readonly GcsLegendSourceGroup[];
  counts: ReadonlyMap<number, GcsLegendCount>;
  display: GcsLegendDisplay;
}): GcsLegendProCategory[] {
  const { categories, places, groups, counts, display } = input;
  const visible = new Set(categories.filter((c) => !c.hidden).map((c) => c.key));
  const shown = groups.filter((g) => g.inLegend && visible.has(places.get(g.id)?.category ?? ""));
  const byId = new Map(shown.map((g) => [g.id, g]));
  const categoryOf = (g: GcsLegendSourceGroup) => places.get(g.id)?.category ?? "";
  const parentOf = (g: GcsLegendSourceGroup): number | null => {
    const p = places.get(g.id)?.parentId ?? null;
    const parent = p === null || p === g.id ? undefined : byId.get(p);
    if (!parent || categoryOf(parent) !== categoryOf(g) || (places.get(parent.id)?.parentId ?? null) !== null) return null;
    return parent.id;
  };
  const posOf = (g: GcsLegendSourceGroup) => places.get(g.id)?.position ?? null;
  const order = (a: GcsLegendSourceGroup, b: GcsLegendSourceGroup) => {
    const pa = posOf(a);
    const pb = posOf(b);
    if (pa !== null && pb !== null && pa !== pb) return pa - pb;
    if (pa !== null && pb === null) return -1;
    if (pa === null && pb !== null) return 1;
    return byPriority(a, b);
  };
  const pick = (g: GcsLegendSourceGroup) => ({
    id: g.id,
    key: g.key,
    name: g.name,
    color: g.color,
    icon: g.icon,
    public: g.public,
    description: g.description,
    count: displayedCount(counts.get(g.id), display),
  });
  return categories
    .filter((c) => !c.hidden)
    .map((c) => {
      const top = shown.filter((g) => categoryOf(g) === c.key && parentOf(g) === null).sort(order);
      const items = top
        .map((g) => {
          const children = shown
            .filter((x) => parentOf(x) === g.id)
            .sort(order)
            .map(pick)
            .filter((x) => !display.hideEmpty || x.count.members > 0);
          const own = pick(g);
          return { ...own, children, childMembers: children.reduce((s, x) => s + x.count.members, 0) };
        })
        .filter((g) => !display.hideEmpty || g.count.members > 0 || g.children.length > 0);
      return { ...c, members: items.reduce((s, g) => s + g.count.members, 0), groups: items };
    })
    .filter((c) => c.groups.length > 0);
}

// ─── Editorul: arborele legendei ───────────────────────────────────────────────────────────────────────────────────

/** Cheia tăviței „Neafișate”: grupurile care nu apar în legendă. */
export const LEGEND_TRAY = "";

/** Un grup de pe primul nivel al unei categorii, cu grupurile legate de el (în dropdown), în ordine. */
export type GcsLegendSlot = { id: number; children: number[] };

/**
 * Starea editorului: categoriile, grupurile fiecărei categorii (și ale tăviței „Neafișate”, cheia `""`, fără copii) în
 * ordine și opțiunile de afișare.
 */
export type GcsLegendTree = {
  categories: GcsLegendCategory[];
  lists: Record<string, GcsLegendSlot[]>;
  display: GcsLegendDisplay;
};

/** Arborele din locurile salvate. Grupurile „ascunse din legendă” (setarea grupului) și cele fără categorie stau în tăviță. */
export function legendTree(input: {
  categories: readonly GcsLegendCategory[];
  places: ReadonlyMap<number, GcsGroupLegendPlace>;
  groups: readonly GcsLegendSourceGroup[];
  display: GcsLegendDisplay;
}): GcsLegendTree {
  const categories = input.categories.map((c) => ({ ...c }));
  const known = new Set(categories.map((c) => c.key));
  const lists: Record<string, GcsLegendSlot[]> = { [LEGEND_TRAY]: [] };
  for (const c of categories) lists[c.key] = [];
  const placeOf = (g: GcsLegendSourceGroup) => input.places.get(g.id) ?? { category: LEGEND_TRAY, parentId: null };
  const inCategory = (g: GcsLegendSourceGroup) => g.inLegend && known.has(placeOf(g).category);
  const byId = new Map(input.groups.map((g) => [g.id, g]));
  const posOf = (g: GcsLegendSourceGroup) => placeOf(g).position ?? null;
  const sorted = [...input.groups].sort((a, b) => {
    const pa = posOf(a);
    const pb = posOf(b);
    if (pa !== null && pb !== null && pa !== pb) return pa - pb;
    if (pa !== null && pb === null) return -1;
    if (pa === null && pb !== null) return 1;
    return byPriority(a, b);
  });
  const parentOf = (g: GcsLegendSourceGroup): number | null => {
    const p = placeOf(g).parentId;
    const parent = p === null || p === g.id ? undefined : byId.get(p);
    if (!parent || !inCategory(parent) || placeOf(parent).category !== placeOf(g).category || placeOf(parent).parentId !== null) return null;
    return parent.id;
  };
  for (const g of sorted) {
    if (!inCategory(g)) lists[LEGEND_TRAY]!.push({ id: g.id, children: [] });
    else if (parentOf(g) === null) lists[placeOf(g).category]!.push({ id: g.id, children: [] });
  }
  for (const g of sorted) {
    if (!inCategory(g)) continue;
    const parent = parentOf(g);
    if (parent === null) continue;
    lists[placeOf(g).category]!.find((s) => s.id === parent)?.children.push(g.id);
  }
  return { categories, lists, display: { ...input.display } };
}

/** Locurile de salvat din arbore: categoria, părintele și poziția (ordinea din editor) fiecărui grup. */
export function legendPlaces(tree: GcsLegendTree): Map<number, GcsGroupLegendPlace> {
  const out = new Map<number, GcsGroupLegendPlace>();
  let position = 0;
  for (const key of [...tree.categories.map((c) => c.key), LEGEND_TRAY]) {
    for (const slot of tree.lists[key] ?? []) {
      out.set(slot.id, { category: key, parentId: null, position: position++ });
      for (const child of slot.children) out.set(child, { category: key, parentId: slot.id, position: position++ });
    }
  }
  return out;
}

const clone = (t: GcsLegendTree): GcsLegendTree => ({
  categories: t.categories.map((c) => ({ ...c })),
  lists: Object.fromEntries(Object.entries(t.lists).map(([k, v]) => [k, v.map((s) => ({ id: s.id, children: [...s.children] }))])),
  display: { ...t.display },
});

/** Unde stă un grup în arbore (categoria, părintele, indexul în lista lui). */
export function findGroup(tree: GcsLegendTree, id: number): { category: string; parentId: number | null; index: number } | null {
  for (const [category, slots] of Object.entries(tree.lists)) {
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i]!;
      if (slot.id === id) return { category, parentId: null, index: i };
      const c = slot.children.indexOf(id);
      if (c !== -1) return { category, parentId: slot.id, index: c };
    }
  }
  return null;
}

/** Ținta unei mutări: categoria (`""` = „Neafișate”), grupul părinte (`null` = primul nivel) și indexul. */
export type GcsLegendTarget = { category: string; parentId: number | null; index: number };

/**
 * Mută un grup: între categorii, în tăviță, sub alt grup (devine grup legat, în dropdown-ul lui) sau în altă poziție.
 * Un singur nivel: un grup cu grupuri legate care devine el însuși legat le lasă pe ale lui pe primul nivel, unde era;
 * în tăviță (fără copii), grupurile lui legate rămân în categorie, pe primul nivel. O țintă imposibilă nu schimbă nimic.
 */
export function moveGroup(tree: GcsLegendTree, id: number, target: GcsLegendTarget): GcsLegendTree {
  const from = findGroup(tree, id);
  if (!from || !(target.category in tree.lists)) return tree;
  if (target.category === LEGEND_TRAY && target.parentId !== null) return tree;
  if (target.parentId === id) return tree;
  const next = clone(tree);
  const list = next.lists[from.category]!;
  // Grupurile legate merg cu părintele pe primul nivel al unei categorii; altfel rămân pe primul nivel, unde era el.
  let carried: number[] = [];
  if (from.parentId === null) {
    const [slot] = list.splice(from.index, 1);
    const kids = slot?.children ?? [];
    if (kids.length > 0 && target.parentId === null && target.category !== LEGEND_TRAY) carried = kids;
    else if (kids.length > 0) list.splice(from.index, 0, ...kids.map((c) => ({ id: c, children: [] })));
  } else {
    list.find((s) => s.id === from.parentId)!.children.splice(from.index, 1);
  }
  if (target.parentId === null) {
    const dest = next.lists[target.category]!;
    dest.splice(Math.max(0, Math.min(target.index, dest.length)), 0, { id, children: carried });
    return next;
  }
  const parent = next.lists[target.category]!.find((s) => s.id === target.parentId);
  if (!parent) return tree;
  parent.children.splice(Math.max(0, Math.min(target.index, parent.children.length)), 0, id);
  return next;
}

/** O cheie nouă de categorie din etichetă (`[a-z0-9_]`, unică), cu rezerva `cat_<n>`. */
export function categoryKeyFor(label: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base =
    label
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 20) || "cat";
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    const key = `${base}_${n}`.slice(0, 24);
    if (!used.has(key)) return key;
  }
}

/** Adaugă o categorie la final (maximum 12; eticheta tăiată la 32 de caractere). */
export function addCategory(tree: GcsLegendTree, label: string, icon?: string): GcsLegendTree {
  const name = label.trim().slice(0, LEGEND_LABEL_MAX);
  if (!name || tree.categories.length >= LEGEND_CATEGORY_MAX) return tree;
  const next = clone(tree);
  const key = categoryKeyFor(name, [...next.categories.map((c) => c.key), "tray"]);
  next.categories.push({ key, label: name, ...(icon && isLegendIcon(icon) ? { icon } : {}) });
  next.lists[key] = [];
  return next;
}

/** Schimbă eticheta, iconița sau vizibilitatea unei categorii. */
export function updateCategory(tree: GcsLegendTree, key: string, patch: Partial<Pick<GcsLegendCategory, "label" | "icon" | "hidden">>): GcsLegendTree {
  if (!tree.categories.some((c) => c.key === key)) return tree;
  const next = clone(tree);
  const c = next.categories.find((x) => x.key === key)!;
  if (patch.label !== undefined) c.label = patch.label.slice(0, LEGEND_LABEL_MAX);
  if (patch.icon !== undefined) {
    if (patch.icon && isLegendIcon(patch.icon)) c.icon = patch.icon;
    else delete c.icon;
  }
  if (patch.hidden !== undefined) {
    if (patch.hidden) c.hidden = true;
    else delete c.hidden;
  }
  return next;
}

/** Mută o categorie la alt index (tragere sau butoanele sus / jos). */
export function moveCategory(tree: GcsLegendTree, key: string, index: number): GcsLegendTree {
  const from = tree.categories.findIndex((c) => c.key === key);
  if (from === -1) return tree;
  const to = Math.max(0, Math.min(index, tree.categories.length - 1));
  if (to === from) return tree;
  const next = clone(tree);
  const [c] = next.categories.splice(from, 1);
  next.categories.splice(to, 0, c!);
  return next;
}

/** Șterge o categorie (măcar una rămâne): grupurile ei, și cele legate, ajung în „Neafișate”. */
export function removeCategory(tree: GcsLegendTree, key: string): GcsLegendTree {
  if (tree.categories.length <= 1 || !tree.categories.some((c) => c.key === key)) return tree;
  const next = clone(tree);
  next.categories = next.categories.filter((c) => c.key !== key);
  const moved = (next.lists[key] ?? []).flatMap((s) => [s.id, ...s.children]);
  delete next.lists[key];
  next.lists[LEGEND_TRAY] = [...(next.lists[LEGEND_TRAY] ?? []), ...moved.map((id) => ({ id, children: [] }))];
  return next;
}

/** Schimbă o opțiune de afișare. */
export function setDisplay<K extends keyof GcsLegendDisplay>(tree: GcsLegendTree, key: K, value: GcsLegendDisplay[K]): GcsLegendTree {
  const next = clone(tree);
  next.display[key] = value;
  return next;
}

/** Erorile unui arbore trimis la salvare (grupuri necunoscute sau duble, mai mult de un nivel, categorii invalide). */
export function legendTreeErrors(tree: GcsLegendTree, groupIds: ReadonlySet<number>): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!validLegendCategories(tree.categories)) errors.categories = "invalid_value";
  if (!validLegendDisplay(tree.display)) errors.display = "invalid_value";
  const keys = new Set([...tree.categories.map((c) => c.key), LEGEND_TRAY]);
  const seen = new Set<number>();
  for (const [key, slots] of Object.entries(tree.lists)) {
    if (!keys.has(key) || !Array.isArray(slots)) {
      errors.groups = "invalid_choice";
      continue;
    }
    for (const slot of slots as unknown[]) {
      if (typeof slot !== "object" || slot === null || !Array.isArray((slot as GcsLegendSlot).children)) {
        errors.groups = "invalid_choice";
        continue;
      }
      const { id, children } = slot as GcsLegendSlot;
      const ids = [id, ...children];
      if (key === LEGEND_TRAY && children.length > 0) errors.groups = "invalid_choice";
      for (const id of ids) {
        if (!Number.isInteger(id) || !groupIds.has(id) || seen.has(id)) errors.groups = "invalid_choice";
        seen.add(id);
      }
    }
  }
  return errors;
}
