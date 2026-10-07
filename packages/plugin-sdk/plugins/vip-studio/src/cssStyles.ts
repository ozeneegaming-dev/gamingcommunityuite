/**
 * Stilurile scrise în CSS de admin (ACP → „Stil nou (CSS)” / „Banner nou (CSS)”). CSS-ul îl verifică, îl închide și îl
 * păstrează GCS (`ctx.members.appearance.styles`): doar declarații, `::before`, `::after` și `@keyframes`, fără
 * selectori, fără adrese din afară; animațiile se opresc singure sub reduced-motion. Pluginul ține elementul de catalog
 * (numele, culoarea de bază, planurile) și ciorna adminului (pentru previzualizare și pentru erorile pe linii), fiindcă
 * paginile ACP nu au JS: „Previzualizează” salvează o ciornă și reîncarcă pagina.
 */
import type { GcsCustomStyleError, GcsPluginApiResponse, GcsPluginContext } from "../../../src/index";
import { back, checked, first, intOf, republishUsersOf, str, type Body } from "./acpActions";
import { hex, inkFor, itemKeyFrom, PLAN_KEY, plainText, type BannerData, type Item, type NameStyleData } from "./model";
import { vipPlans } from "./publish";
import { audit, createItem, getItem, listCategories, updateItem } from "./store";

export type CssKind = "name_style" | "banner";
const CORE_KIND = { name_style: "name", banner: "banner" } as const;
const DRAFT_TTL = 86_400;

/** Ciorna unui admin: textul, câmpurile formularului, erorile și clasa de previzualizare (după „Previzualizează”). */
export type CssDraft = {
  css: string;
  name: string;
  color: string;
  text: string;
  plans: string[];
  categoryId: number | null;
  enabled: boolean;
  errors: GcsCustomStyleError[];
  previewClass: string | null;
};

const draftKey = (ctx: GcsPluginContext, kind: CssKind, id: number | null) => `cssdraft:${ctx.viewer.userId ?? "anon"}:${kind}:${id ?? "new"}`;

/** Cheia stilului de previzualizare al unui admin (unul pe admin și tip, suprascris la fiecare previzualizare). */
export const previewKey = (userId: string | null) => `pv_${(userId ?? "anon").toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 36)}`;

export async function cssDraft(ctx: GcsPluginContext, kind: CssKind, id: number | null): Promise<CssDraft | null> {
  return ctx.cache.get<CssDraft>(draftKey(ctx, kind, id));
}

/** Șabloanele de pornire (CSS original, de copiat și modificat). Fără `\` (escape-urile nu sunt permise). */
export const CSS_TEMPLATES: Record<CssKind, Record<string, string>> = {
  name_style: {
    foc: `/* Foc: litere calde, flăcări care pâlpâie în sus */
position: relative;
color: #ffe8a3;
text-shadow: 0 0 4px #ffb703, 0 -2px 8px #fb8500, 0 -6px 16px #e63946;
animation: palpaie 1.6s ease-in-out infinite alternate;

@keyframes palpaie {
  from { text-shadow: 0 0 4px #ffb703, 0 -2px 8px #fb8500, 0 -6px 16px #e63946; }
  to { text-shadow: 0 0 6px #ffd166, 0 -4px 12px #fb8500, 0 -10px 24px #d62828; }
}
`,
    neon: `/* Neon roz cu bâzâit */
position: relative;
color: #fff0fb;
text-shadow: 0 0 2px #ffffff, 0 0 8px #ff4fd8, 0 0 18px #ff4fd8, 0 0 36px #b100e8;
animation: bazait 4s linear infinite;

@keyframes bazait {
  0%, 18%, 22%, 100% { opacity: 1; }
  20% { opacity: .55; }
}
`,
    gradient: `/* Gradient care curge prin litere */
position: relative;
background: linear-gradient(90deg, #00f5a0, #00d9f5, #7b2ff7, #00f5a0);
background-size: 200% 100%;
-webkit-background-clip: text;
background-clip: text;
color: transparent;
-webkit-text-fill-color: transparent;
animation: curge 4s linear infinite;

@keyframes curge {
  to { background-position: 200% 0; }
}
`,
    glitch: `/* Glitch: un strat roșu decalat care sare din când în când */
position: relative;
color: #f2f2f2;
text-shadow: 2px 0 #ff2e63, -2px 0 #08d9d6;

::before {
  content: attr(data-text);
  position: absolute;
  left: 0;
  top: 0;
  color: #ff2e63;
  clip-path: inset(0 0 55% 0);
  animation: taie 2.4s steps(1) infinite;
}

@keyframes taie {
  0%, 88%, 100% { transform: none; }
  91% { transform: translateX(-3px); }
  95% { transform: translateX(3px); }
}
`,
  },
  banner: {
    aur: `/* Banner auriu cu o sclipire care trece */
background: linear-gradient(110deg, #7a4b00 0%, #d4a017 35%, #fff3b0 50%, #d4a017 65%, #7a4b00 100%);
background-size: 250% 100%;
color: #1a1200;
box-shadow: 0 0 12px rgba(255, 211, 77, .45);
animation: luciu 3s ease-in-out infinite;

@keyframes luciu {
  from { background-position: 100% 0; }
  to { background-position: 0 0; }
}
`,
    neon: `/* Banner neon pe fundal închis */
background: #0b0d12;
color: #ff4fd8;
border: 1px solid #ff4fd8;
box-shadow: 0 0 8px #ff4fd8, inset 0 0 8px rgba(255, 79, 216, .4);
text-shadow: 0 0 6px #ff4fd8;
`,
    gradient: `/* Banner cu gradient care curge */
background: linear-gradient(90deg, #ff0080, #7928ca, #2afadf, #ff0080);
background-size: 300% 100%;
color: #ffffff;
animation: curge 5s linear infinite;

@keyframes curge {
  to { background-position: 300% 0; }
}
`,
    foc: `/* Banner de foc */
background: linear-gradient(0deg, #b80000, #ff6a00 60%, #ffd000);
color: #fff8e1;
text-shadow: 0 1px 2px rgba(0, 0, 0, .5);
box-shadow: 0 0 10px rgba(255, 106, 0, .6);
animation: arde 1.4s ease-in-out infinite alternate;

@keyframes arde {
  from { box-shadow: 0 0 8px rgba(255, 106, 0, .5); }
  to { box-shadow: 0 0 16px rgba(255, 60, 0, .85); }
}
`,
  },
};

/** Câmpurile formularului CSS, curățate (fără CSS-ul, verificat de GCS). */
async function fieldsOf(ctx: GcsPluginContext, kind: CssKind, body: Body): Promise<Omit<CssDraft, "css" | "errors" | "previewClass">> {
  const known = new Set((await vipPlans(ctx)).map((p) => p.key));
  const plans = (Array.isArray(body.plans) ? body.plans : body.plans ? [body.plans] : []).filter((p): p is string => typeof p === "string" && PLAN_KEY.test(p) && known.has(p));
  const categoryId = intOf(body.categoryId);
  const categories = kind === "name_style" ? await listCategories(ctx, kind) : [];
  return {
    name: plainText(first(body.name), 40) ?? "",
    color: hex(str(body.color)) ?? "#FFFFFF",
    text: hex(str(body.text)) ?? "#FFFFFF",
    plans,
    categoryId: categoryId !== null && categories.some((c) => c.id === categoryId) ? categoryId : null,
    enabled: checked(body.enabled),
  };
}

/** POST `/acp/css`: „Previzualizează” (ciornă + stil de previzualizare) sau „Salvează” (stilul și elementul). */
export async function cssAction(ctx: GcsPluginContext, body: Body): Promise<GcsPluginApiResponse> {
  const kind = str(body.kind) as CssKind;
  if (kind !== "name_style" && kind !== "banner") return back("", { error: "invalid" });
  const id = intOf(body.id);
  const previous: Item | null = id !== null ? await getItem(ctx, id) : null;
  if (id !== null && (!previous || previous.kind !== kind || !(previous.data as { custom?: true }).custom)) return back(kind === "name_style" ? "/name-styles" : "/banners", { error: "not_found" });
  const formPath = previous ? `/item/${previous.id}` : `/css/${kind}`;
  const css = str(body.css).slice(0, 12_000);
  const fields = await fieldsOf(ctx, kind, body);
  const coreKind = CORE_KIND[kind];
  const saveDraft = async (errors: GcsCustomStyleError[], previewClass: string | null) =>
    ctx.cache.set(draftKey(ctx, kind, previous?.id ?? null), { css, ...fields, errors, previewClass }, DRAFT_TTL);

  if (str(body.op) === "preview") {
    const r = await ctx.members.appearance.styles.set(coreKind, previewKey(ctx.viewer.userId), css);
    await saveDraft(r.ok ? [] : r.errors, r.ok ? r.className : null);
    return back(formPath, { draft: "1", ...(r.ok ? {} : { error: "css_invalid" }) });
  }

  if (!fields.name) {
    await saveDraft([], null);
    return back(formPath, { draft: "1", error: "name_required" });
  }
  const key = previous?.key ?? itemKeyFrom(fields.name, Math.random().toString(36).slice(2, 7));
  const r = await ctx.members.appearance.styles.set(coreKind, key, css);
  if (!r.ok) {
    await saveDraft(r.errors, null);
    return back(formPath, { draft: "1", error: "css_invalid" });
  }
  const data: NameStyleData | BannerData =
    kind === "name_style"
      ? { effect: "none", variants: [{ key: "default", colors: [fields.color] }], angle: 90, animation: "none", speed: "normal", bold: true, italic: false, custom: true }
      : { fill: { colors: [fields.color], angle: 90, animation: "none", speed: "normal" }, text: fields.text || inkFor(fields.color), custom: true };
  const input = { name: fields.name, categoryId: fields.categoryId, data, plans: fields.plans, enabled: fields.enabled, retired: false };
  let itemId: number;
  if (previous) {
    await updateItem(ctx, previous.id, input, kind);
    itemId = previous.id;
    await audit(ctx, "css_update", `${kind}/${key}`);
    await republishUsersOf(ctx, kind, key);
  } else {
    itemId = await createItem(ctx, { kind, key, ...input });
    await audit(ctx, "css_create", `${kind}/${key}`);
  }
  // Ciorna și stilul de previzualizare nu mai trebuie.
  await ctx.cache.delete(draftKey(ctx, kind, previous?.id ?? null));
  await ctx.members.appearance.styles.set(coreKind, previewKey(ctx.viewer.userId), null);
  return back(`/item/${itemId}`, { saved: "1" });
}

/** Sursa CSS a unui element (păstrată de GCS sub cheia lui). */
export async function cssOf(ctx: GcsPluginContext, item: Item): Promise<string> {
  const list = await ctx.members.appearance.styles.list(CORE_KIND[item.kind as CssKind]);
  return list.find((s) => s.key === item.key)?.css ?? "";
}
