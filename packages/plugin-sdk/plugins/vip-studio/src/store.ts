/**
 * Datele Studioului VIP, în schema proprie a pluginului (`migrations/001_init.sql`): catalogul, categoriile,
 * echipamentele membrilor și jurnalul acțiunilor din ACP. Doar SQL parametrizat.
 */
import type { GcsPluginContext } from "../../../src/index";
import type { Loadout } from "./loadout";
import { mediaIdsOf, parseItemData, PLAN_KEY, type Category, type Item, type ItemData, type Kind, type NameStyleData } from "./model";
import { defaultPresets, LEGACY_NAME_MAP, LEGACY_NAME_STYLES, nameStyleData, PRESETS_VERSION } from "./presets";

type ItemRow = {
  id: number;
  kind: Kind;
  key: string;
  name: string;
  category_id: number | null;
  data: unknown;
  plans: string[] | null;
  enabled: boolean;
  retired: boolean;
  position: number;
  media_ids: string[] | null;
  created_at: string;
};

const ITEM_COLUMNS = "id, kind, key, name, category_id, data, plans, enabled, retired, position, media_ids, created_at";

function toItem(r: ItemRow): Item | null {
  const parsed = parseItemData(r.kind, r.data);
  if (!parsed.ok) return null;
  return {
    id: r.id,
    kind: r.kind,
    key: r.key,
    name: r.name,
    categoryId: r.category_id,
    data: parsed.data,
    plans: (r.plans ?? []).filter((p) => PLAN_KEY.test(p)),
    enabled: r.enabled,
    retired: r.retired,
    position: r.position,
    mediaIds: r.media_ids ?? [],
    createdAt: typeof r.created_at === "string" ? r.created_at : new Date(r.created_at as unknown as number).toISOString(),
  };
}

/** Catalogul implicit, o singură dată pe versiune (idempotent: rulează la fel și în web, și în worker). */
let seededVersion = 0;
export async function ensureSeeded(ctx: GcsPluginContext): Promise<void> {
  if (seededVersion >= PRESETS_VERSION) return;
  const [meta] = await ctx.db.query<{ value: number }>("SELECT (value)::int AS value FROM meta WHERE key = 'presets_version'");
  const stored = meta?.value ?? 0;
  if (stored >= PRESETS_VERSION) {
    seededVersion = stored;
    return;
  }
  await insertPresets(ctx, false);
  // O instalare veche (catalogul 1): stilurile de nume vechi, neschimbate de admin, fac loc catalogului nou.
  if (stored === 1) {
    const moved = await upgradeNameStyles(ctx);
    if (moved.users > 0) await ctx.jobs.enqueue("reconcile", {});
    if (moved.replaced > 0) await audit(ctx, "presets_upgrade", `${moved.replaced}/${moved.users}`);
  }
  seededVersion = PRESETS_VERSION;
}

/**
 * Actualizarea la catalogul 2 (pluginul 1.0.1): fiecare stil de nume din versiunea 1 pe care adminul nu l-a schimbat
 * (nume, date, planuri, categorie, activ / retras) se înlocuiește cu stilul nou cel mai apropiat; membrii care îl
 * aveau ales trec pe acela (cu varianta potrivită), apoi stilul vechi se șterge. Stilurile vechi schimbate de admin
 * rămân neatinse (sunt ale lui). Idempotentă.
 */
export async function upgradeNameStyles(ctx: GcsPluginContext): Promise<{ replaced: number; users: number }> {
  const current = new Map((await listItems(ctx, "name_style")).map((i) => [i.key, i]));
  const replaced: string[] = [];
  let users = 0;
  for (const legacy of LEGACY_NAME_STYLES) {
    const item = current.get(legacy.key);
    const target = LEGACY_NAME_MAP[legacy.key];
    const next = target ? current.get(target.to) : undefined;
    if (!item || !target || !next) continue;
    const parsed = parseItemData("name_style", nameStyleData(legacy));
    const untouched =
      parsed.ok && item.name === legacy.name && JSON.stringify(item.data) === JSON.stringify(parsed.data) && item.plans.length === 0 && item.categoryId === null && item.enabled && !item.retired;
    if (!untouched) continue;
    const variants = (next.data as NameStyleData).variants.map((x) => x.key);
    const rows = await ctx.db.query<{ user_id: string; data: Record<string, unknown> }>("SELECT user_id, data FROM loadouts WHERE data->>'nameStyle' = $1", [legacy.key]);
    const statements = rows.map((r) => {
      const old = typeof r.data.nameVariant === "string" ? r.data.nameVariant : "";
      const wanted = target.variant ?? target.variants?.[old] ?? old;
      const variant = variants.includes(wanted) ? wanted : variants[0]!;
      return { sql: "UPDATE loadouts SET data = $2::jsonb, updated_at = now() WHERE user_id = $1", params: [r.user_id, JSON.stringify({ ...r.data, nameStyle: next.key, nameVariant: variant })] };
    });
    await ctx.db.batch([...statements, { sql: "DELETE FROM items WHERE id = $1", params: [item.id] }]);
    users += rows.length;
    replaced.push(legacy.key);
  }
  return { replaced: replaced.length, users };
}

/**
 * Inserează presetările lipsă (sau, cu `restore`, le readuce pe toate la forma implicită: nume, date, ordine).
 * Categoriile se creează după nume, pe tipuri.
 */
export async function insertPresets(ctx: GcsPluginContext, restore: boolean): Promise<number> {
  const presets = defaultPresets().map((p, i) => {
    const parsed = parseItemData(p.kind, p.data);
    if (!parsed.ok) throw new Error(`preset ${p.kind}/${p.key}: ${parsed.field}`);
    return { ...p, data: parsed.data, position: i };
  });
  const categories = [...new Set(presets.filter((p) => p.category).map((p) => `${p.kind}\u0001${p.category}`))].map((k, i) => {
    const [kind, name] = k.split("\u0001");
    return { kind, name, position: i };
  });
  const rows = presets.map((p) => ({ kind: p.kind, key: p.key, name: p.name, category: p.category ?? null, data: p.data, plans: p.plans ?? [], position: p.position }));
  const counts = await ctx.db.batch([
    {
      sql: `INSERT INTO categories (kind, name, position)
            SELECT c.kind, c.name, c.position FROM jsonb_to_recordset($1::jsonb) AS c(kind text, name text, position int)
            WHERE NOT EXISTS (SELECT 1 FROM categories x WHERE x.kind = c.kind AND x.name = c.name)`,
      params: [JSON.stringify(categories)],
    },
    {
      // Presetările nu sunt „noi”: eticheta NOU rămâne pentru ce adaugă adminul.
      sql: `INSERT INTO items (kind, key, name, category_id, data, plans, position, created_at)
            SELECT r.kind, r.key, r.name, (SELECT id FROM categories c WHERE c.kind = r.kind AND c.name = r.category ORDER BY id LIMIT 1), r.data, ARRAY(SELECT jsonb_array_elements_text(r.plans)), r.position, now() - interval '400 days'
            FROM jsonb_to_recordset($1::jsonb) AS r(kind text, key text, name text, category text, data jsonb, plans jsonb, position int)
            ON CONFLICT (kind, key) DO ${restore ? "UPDATE SET name = EXCLUDED.name, data = EXCLUDED.data, category_id = EXCLUDED.category_id, position = EXCLUDED.position, retired = false, enabled = true, media_ids = '{}'" : "NOTHING"}`,
      params: [JSON.stringify(rows)],
    },
    {
      sql: "INSERT INTO meta (key, value) VALUES ('presets_version', $1::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
      params: [JSON.stringify(PRESETS_VERSION)],
    },
  ]);
  return counts[1] ?? 0;
}

export async function listItems(ctx: GcsPluginContext, kind?: Kind): Promise<Item[]> {
  const rows = kind
    ? await ctx.db.query<ItemRow>(`SELECT ${ITEM_COLUMNS} FROM items WHERE kind = $1 ORDER BY position, id`, [kind])
    : await ctx.db.query<ItemRow>(`SELECT ${ITEM_COLUMNS} FROM items ORDER BY kind, position, id`);
  return rows.map(toItem).filter((i): i is Item => i !== null);
}

export async function getItem(ctx: GcsPluginContext, id: number): Promise<Item | null> {
  const [row] = await ctx.db.query<ItemRow>(`SELECT ${ITEM_COLUMNS} FROM items WHERE id = $1`, [id]);
  return row ? toItem(row) : null;
}

/**
 * Elementele cu fișiere încărcate care lipsesc (șterse din afara pluginului): apar ca retrase. Fișierele din pachet
 * (`assets/…`) nu au id și nu se verifică.
 */
export async function markMissingMedia(ctx: GcsPluginContext, items: Item[]): Promise<Item[]> {
  const ids = [...new Set(items.flatMap((i) => i.mediaIds))];
  if (ids.length === 0) return items;
  const found = new Set<string>();
  for (let i = 0; i < ids.length; i += 200) for (const m of await ctx.media.get(ids.slice(i, i + 200))) found.add(m.id);
  return items.map((item) => (item.mediaIds.some((id) => !found.has(id)) ? { ...item, retired: true } : item));
}

export type ItemInput<K extends Kind = Kind> = { kind: K; key: string; name: string; categoryId: number | null; data: ItemData[K]; plans: string[]; enabled: boolean; retired: boolean };

export async function createItem(ctx: GcsPluginContext, input: ItemInput): Promise<number> {
  const [row] = await ctx.db.query<{ id: number }>(
    `INSERT INTO items (kind, key, name, category_id, data, plans, enabled, retired, media_ids, position)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::text[], $7, $8, $9::text[], COALESCE((SELECT max(position) + 1 FROM items WHERE kind = $1), 0)) RETURNING id`,
    [input.kind, input.key, input.name, input.categoryId, JSON.stringify(input.data), input.plans, input.enabled, input.retired, mediaIdsOf(input.kind, input.data)],
  );
  return row!.id;
}

export async function updateItem(ctx: GcsPluginContext, id: number, input: Omit<ItemInput, "kind" | "key">, kind: Kind): Promise<void> {
  await ctx.db.execute(
    `UPDATE items SET name = $2, category_id = $3, data = $4::jsonb, plans = $5::text[], enabled = $6, retired = $7, media_ids = $8::text[] WHERE id = $1`,
    [id, input.name, input.categoryId, JSON.stringify(input.data), input.plans, input.enabled, input.retired, mediaIdsOf(kind, input.data)],
  );
}

export async function deleteItem(ctx: GcsPluginContext, id: number): Promise<void> {
  await ctx.db.execute("DELETE FROM items WHERE id = $1", [id]);
}

/** Mută un element cu o poziție mai sus sau mai jos, în catalogul lui (schimbă locul cu vecinul). */
export async function moveItem(ctx: GcsPluginContext, item: Item, dir: -1 | 1): Promise<void> {
  const list = await listItems(ctx, item.kind);
  const at = list.findIndex((i) => i.id === item.id);
  const other = list[at + dir];
  if (at === -1 || !other) return;
  // Pozițiile se renumerotează (presetările pot avea poziții egale după restaurare).
  const order = list.map((i) => i.id);
  order[at] = other.id;
  order[at + dir] = item.id;
  await ctx.db.execute("UPDATE items SET position = o.pos FROM (SELECT * FROM unnest($1::int[]) WITH ORDINALITY AS t(id, pos)) o WHERE items.id = o.id", [order]);
}

export async function setItemFlags(ctx: GcsPluginContext, id: number, flags: { enabled?: boolean; retired?: boolean }): Promise<void> {
  if (flags.enabled !== undefined) await ctx.db.execute("UPDATE items SET enabled = $2 WHERE id = $1", [id, flags.enabled]);
  if (flags.retired !== undefined) await ctx.db.execute("UPDATE items SET retired = $2 WHERE id = $1", [id, flags.retired]);
}

/** Câte elemente din catalog folosesc acest fișier (un fișier se șterge doar când nu-l mai folosește nimeni). */
export async function mediaInUse(ctx: GcsPluginContext, mediaId: string): Promise<boolean> {
  const [row] = await ctx.db.query<{ n: number }>("SELECT count(*)::int AS n FROM items WHERE $1 = ANY(media_ids)", [mediaId]);
  const [song] = await ctx.db.query<{ n: number }>("SELECT count(*)::int AS n FROM loadouts WHERE data->'customSong'->>'audioId' = $1", [mediaId]);
  return (row?.n ?? 0) + (song?.n ?? 0) > 0;
}

// ─── Categoriile ───

export async function listCategories(ctx: GcsPluginContext, kind?: Kind): Promise<Category[]> {
  const rows = kind
    ? await ctx.db.query<Category>("SELECT id, kind, name, position FROM categories WHERE kind = $1 ORDER BY position, id", [kind])
    : await ctx.db.query<Category>("SELECT id, kind, name, position FROM categories ORDER BY kind, position, id");
  return rows;
}

export async function createCategory(ctx: GcsPluginContext, kind: Kind, name: string): Promise<void> {
  await ctx.db.execute("INSERT INTO categories (kind, name, position) VALUES ($1, $2, COALESCE((SELECT max(position) + 1 FROM categories WHERE kind = $1), 0))", [kind, name]);
}

export async function renameCategory(ctx: GcsPluginContext, id: number, name: string): Promise<void> {
  await ctx.db.execute("UPDATE categories SET name = $2 WHERE id = $1", [id, name]);
}

export async function deleteCategory(ctx: GcsPluginContext, id: number): Promise<void> {
  await ctx.db.execute("DELETE FROM categories WHERE id = $1", [id]);
}

// ─── Echipamentele ───

type LoadoutRow = { user_id: string; data: Loadout; test_mode: boolean; updated_at: string };

export async function getLoadout(ctx: GcsPluginContext, userId: string): Promise<{ loadout: Loadout; testMode: boolean; updatedAt: string } | null> {
  const [row] = await ctx.db.query<LoadoutRow>("SELECT user_id, data, test_mode, updated_at FROM loadouts WHERE user_id = $1", [userId]);
  return row ? { loadout: (row.data ?? {}) as Loadout, testMode: row.test_mode, updatedAt: String(row.updated_at) } : null;
}

export async function saveLoadout(ctx: GcsPluginContext, userId: string, loadout: Loadout, testMode: boolean): Promise<void> {
  await ctx.db.execute(
    `INSERT INTO loadouts (user_id, data, test_mode, updated_at) VALUES ($1, $2::jsonb, $3, now())
     ON CONFLICT (user_id) DO UPDATE SET data = EXCLUDED.data, test_mode = EXCLUDED.test_mode, updated_at = now()`,
    [userId, JSON.stringify(loadout), testMode],
  );
}

export async function deleteLoadout(ctx: GcsPluginContext, userId: string): Promise<void> {
  await ctx.db.execute("DELETE FROM loadouts WHERE user_id = $1", [userId]);
}

/** Echipamentele, cele mai recente întâi (pagina „Membri” din ACP și reconcilierea). */
export async function listLoadouts(ctx: GcsPluginContext, opts: { limit: number; offset: number }): Promise<{ userId: string; loadout: Loadout; testMode: boolean; updatedAt: string }[]> {
  const rows = await ctx.db.query<LoadoutRow>("SELECT user_id, data, test_mode, updated_at FROM loadouts ORDER BY updated_at DESC LIMIT $1 OFFSET $2", [opts.limit, opts.offset]);
  return rows.map((r) => ({ userId: r.user_id, loadout: (r.data ?? {}) as Loadout, testMode: r.test_mode, updatedAt: String(r.updated_at) }));
}

export async function countLoadouts(ctx: GcsPluginContext): Promise<number> {
  const [row] = await ctx.db.query<{ n: number }>("SELECT count(*)::int AS n FROM loadouts");
  return row?.n ?? 0;
}

/** Userii ale căror echipamente folosesc un element (după modificarea lui: aspectul se republică). */
export async function usersOfItem(ctx: GcsPluginContext, kind: Kind, key: string): Promise<string[]> {
  const field = { name_style: "nameStyle", banner: "banner", frame: "frame", card: "card", weapon: "weapon", background: "background", theme: "theme", song: "song" }[kind];
  const rows = await ctx.db.query<{ user_id: string }>(`SELECT user_id FROM loadouts WHERE data->>$1 = $2 LIMIT 1000`, [field, key]);
  return rows.map((r) => r.user_id);
}

// ─── Jurnalul ───

export async function audit(ctx: GcsPluginContext, action: string, detail: string): Promise<void> {
  await ctx.db.batch([
    { sql: "INSERT INTO audit (actor_id, action, detail) VALUES ($1, $2, $3)", params: [ctx.viewer.userId, action, detail.slice(0, 300)] },
    { sql: "DELETE FROM audit WHERE id IN (SELECT id FROM audit ORDER BY id DESC OFFSET 500)" },
  ]);
}

export async function recentAudit(ctx: GcsPluginContext, limit = 20): Promise<{ actor_id: string | null; action: string; detail: string; created_at: string }[]> {
  return ctx.db.query("SELECT actor_id, action, detail, created_at FROM audit ORDER BY id DESC LIMIT $1", [limit]);
}
