/**
 * @gcs/plugin-sdk — tipurile pentru codul server al unui plugin GamingCommunitySuite (`server.mjs`).
 *
 * Pluginul rulează izolat (un fir separat, fără module Node și fără acces la baza de date a site-ului): singura lui
 * legătură cu GCS e contextul `ctx` primit de fiecare handler. Tot ce e aici sunt tipuri, plus `definePlugin`, o funcție
 * identitate care se include în bundle (nu cere nimic din GCS la rulare).
 */

/** O valoare JSON (setări, payload-uri, rezultate). */
export type GcsPluginJson = null | boolean | number | string | GcsPluginJson[] | { [key: string]: GcsPluginJson };

/**
 * HTML randat de plugin: un șir sau `{ html }`. Trece prin sanitizer (listă albă de taguri și atribute, fără scripturi
 * sau `id`; `style` doar cu variabile CSS sigure, `--nume: #hex | număr | identificator`; clase `gcsp-*`). Paginile
 * (site și ACP) pot avea formulare (doar spre rutele API ale pluginului, sau GET spre paginile lui) și `audio`/`video`
 * cu fișierele pluginului. `<gcs-icon name="fa-solid fa-star"></gcs-icon>` devine iconița Font Awesome.
 * `{ template, data }` e rezervat motorului de șabloane.
 */
export type GcsPluginHtml = string | { html: string } | { template: string; data?: Record<string, GcsPluginJson> };

/** Vizitatorul pentru care rulează apelul (în evenimente și joburi: vizitator anonim). */
export type GcsPluginViewer = { userId: string | null; isGuest: boolean };

export type GcsPluginUser = {
  id: string;
  name: string;
  /** Cheia grupului principal. */
  groupKey: string;
  /** Stilul numelui (clasa `gcs-name--<cheie>`): stilul ales de membru sau grupul principal. */
  nameKey: string;
  /** Rama avatarului (clasa `gcs-avatarFrame--<cheie>`), dacă are. */
  frameKey: string | null;
  avatarUrl: string | null;
  joinedAt: string;
  postsCount: number;
  url: string;
};

export type GcsPluginTopic = {
  id: number;
  title: string;
  forumId: number;
  authorId: string | null;
  createdAt: string;
  lastPostAt: string;
  repliesCount: number;
  url: string;
};

export type GcsPluginPost = { id: number; topicId: number; topicTitle: string; authorId: string | null; createdAt: string; text: string; url: string };

export type GcsPluginForum = { id: number; name: string; parentId: number | null; topicsCount: number; postsCount: number; url: string };

export type GcsPluginStats = { topics: number; posts: number; members: number };

/** Un plan VIP (un grup VIP). */
export type GcsPluginVipPlan = { key: string; name: string; color: string | null; icon: string | null; position: number };
/** Abonamentul VIP activ al unui user (`plan: null` = fără VIP). */
export type GcsPluginVipStatus = { userId: string; plan: string | null; planName: string | null; since: string | null; expiresAt: string | null };
/** Un membru VIP activ (widget-uri de tip „VIP online”). Starea online respectă confidențialitatea lui. */
export type GcsPluginVipMember = {
  id: string;
  name: string;
  url: string;
  avatarUrl: string | null;
  groupKey: string;
  nameKey: string;
  frameKey: string | null;
  plan: string;
  planName: string;
  online: boolean;
  lastActiveAt: string | null;
};

/**
 * Un fișier media al pluginului (capabilitatea `media`), verificat de GCS; imaginile sunt recodate în WebP (cele animate
 * — GIF, APNG, WebP — rămân animate, ca WebP animat).
 */
export type GcsPluginMediaInfo = {
  id: string;
  kind: "image" | "video" | "audio";
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  /** Adresa publică: `/plugins/<cheie>/media/<id>.<ext>`. */
  url: string;
  status: "pending" | "kept";
  createdAt: string;
  /** Doar la încărcare (în corpul formularului; GCS ≥ 0.7.1): SHA-256 al fișierului trimis (hex), pentru duplicate. */
  sha256?: string;
  /** Doar la încărcare: numele original al fișierului (fără cale, doar text). */
  originalName?: string;
  /** Doar la încărcare: numărul de cadre al imaginii (> 1 = animată). */
  frames?: number;
};
/**
 * Un fișier respins de GCS la încărcare (pe câmpul lui din formular): `too_large`, `unsupported_type`, `too_long`,
 * `invalid_image`, `too_many_frames`, `animation_too_large`, `processing_timeout`, `quota_exceeded`, `rate_limited`,
 * `too_many_files`… Parametrii mesajului (ex. `maxMb`) și, de la GCS 0.7.1, `originalName` (numele fișierului).
 */
export type GcsPluginMediaError = { error: string; [param: string]: string };

/**
 * Efectele numelui (lista albă a GCS). De la GCS 0.7.1 și: `gradient`, `inferno`, `typewriter`, `reveal`, `shatter`,
 * `citylights`, `cosmic`, `crosshair`, `love`, `electric`, `mirror`, `lightning`, `money`, `razor`, `shadowdance`,
 * `toxic`, `vscan`, `gold`, `aura`, `matrix`, `frost`, `plasma`, `outline`, `extrude`. Previzualizarea în paginile
 * pluginului: `<span class="gcs-nfx gcs-nfx--<efect> gcs-nfx--n<culori>" data-text="Nume" style="--nfx-c1:#…">Nume</span>`.
 */
export type GcsNameEffect =
  | "none"
  | "gradient"
  | "shimmer"
  | "pulse"
  | "neon"
  | "glitch"
  | "scan"
  | "chrome"
  | "fire"
  | "holo"
  | "caret"
  | "inferno"
  | "typewriter"
  | "reveal"
  | "shatter"
  | "citylights"
  | "cosmic"
  | "crosshair"
  | "love"
  | "electric"
  | "mirror"
  | "lightning"
  | "money"
  | "razor"
  | "shadowdance"
  | "toxic"
  | "vscan"
  | "gold"
  | "aura"
  | "matrix"
  | "frost"
  | "plasma"
  | "outline"
  | "extrude"
  | GcsTextNameEffect;

/**
 * Categoria „Efecte text” (GCS ≥ 0.8.0). Cele pe litere (`magnetic` … `mercur`) le desenează GCS pe literele numelui;
 * în previzualizări, numele are textul simplu și literele separate (vezi `GcsMemberName`):
 * `<span class="gcs-name__t">Nume</span><span class="gcs-name__ls" aria-hidden="true"><b style="--i:0" data-c="N"></b>…</span>`.
 */
export type GcsTextNameEffect =
  | "boreal"
  | "cameleon"
  | "lichid"
  | "obsidian"
  | "sclipire"
  | "glitch_scan"
  | "vid"
  | "scaner"
  | "jar"
  | "ecou"
  | "feliat"
  | "tremur"
  | "anaglif"
  | "fosfor"
  | "reflector"
  | "elastic"
  | "puls_cardiac"
  | "marker"
  | "cadran"
  | "negativ"
  | "holograma"
  | "folie"
  | "pixeli"
  | "praf_stele"
  | "vapori"
  | "plasa"
  | "irizat"
  | "sticla"
  | "flux_date"
  | "prisma"
  | "laser"
  | "microcip"
  | "termic"
  | "semnal"
  | "portal"
  | "duoton"
  | "eclipsa"
  | "voal"
  | "marmura"
  | "unde"
  | "fantoma"
  | "lenticular"
  | "caustic"
  | "magnetic"
  | "val_litere"
  | "unda"
  | "focus"
  | "spectru"
  | "pop"
  | "topire"
  | "cinetic"
  | "orbite"
  | "paralaxa"
  | "ploaie_litere"
  | "zootrop"
  | "pendul"
  | "fum"
  | "kilovolt"
  | "spargere"
  | "karaoke"
  | "retro"
  | "mercur";

/** O eroare a unui stil CSS scris de admin: linia, codul (`css_forbidden`, `css_selector`, `css_url`…) și detaliul. */
export type GcsCustomStyleError = { line: number; code: string; detail?: string };
/** Rezultatul verificării / salvării unui stil CSS: clasa lui (pentru previzualizări) sau erorile pe linii. */
export type GcsCustomStyleResult = { ok: true; className: string } | { ok: false; errors: GcsCustomStyleError[] };

/** O umplere: 1 culoare (plină) sau 2–5 (gradient), unghiul și animația din lista albă. */
export type GcsAppearanceFill = { colors: string[]; angle?: number; animation?: "none" | "flow" | "pulse" | "shine" | "aurora"; speed?: "slow" | "normal" | "fast" };
/** Calea unui fișier al pluginului: `/plugins/<cheie>/assets/…` (imagini din pachet) sau `/plugins/<cheie>/media/<id>.<ext>`. */
export type GcsAppearanceMedia = string;

/**
 * Aspectul unui membru (capabilitatea `appearance`), validat și randat de GCS: numele (oriunde apare), rama (peste
 * avatar), banner-ul și fundalul cardului (postbit, hover card), insigna, iar pe profil fundalul, citatul, tema și melodia.
 * Culorile sunt `#RRGGBB`; nimic nu e CSS sau HTML brut.
 */
export type GcsMemberAppearance = {
  name?: {
    fill: GcsAppearanceFill;
    effect?: GcsNameEffect;
    glow?: string;
    bold?: boolean;
    italic?: boolean;
    /** Cheia unui stil CSS al pluginului (`ctx.members.appearance.styles.set("name", …)`, GCS ≥ 0.7.1). */
    style?: string;
  };
  /** `style`: cheia unui stil CSS de banner al pluginului (GCS ≥ 0.7.1); banner-ul îl desenează atunci clasa stilului. */
  banner?: { fill: GcsAppearanceFill; text?: string; label?: string; style?: string };
  /** `scale` 100–160 (mărimea ramei față de avatar, în %), `x`/`y` -20…20 (decalaj în %). */
  frame?: { image: GcsAppearanceMedia; scale?: number; x?: number; y?: number };
  /** `x`/`y` 0–100 (poziția imaginii), `dim` 0–80 (întunecarea, în %). */
  card?: { image: GcsAppearanceMedia; x?: number; y?: number; dim?: number };
  flair?: { icon: GcsAppearanceMedia; label: string };
  profile?: {
    /** `video` cere `image` (posterul, afișat și sub reduced-motion). */
    background?: { image?: GcsAppearanceMedia; video?: GcsAppearanceMedia; x?: number; y?: number; dim?: number };
    quote?: { text: string };
    theme?: { key: string; accent: string; accent2?: string; surface?: string; glow?: boolean };
    /** Un fișier audio sau un id YouTube (11 caractere); niciodată redare automată cu sunet. */
    song?: { title: string; artist?: string; audio?: GcsAppearanceMedia; youtube?: string; autoplayMuted?: boolean };
  };
};

export type GcsPluginFetchInit = { method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; headers?: Record<string, string>; body?: string };
export type GcsPluginFetchResponse = { status: number; headers: Record<string, string>; body: string };

/** Contextul primit de fiecare handler. Toate apelurile asincrone trec prin gazdă, care le verifică. */
export interface GcsPluginContext {
  readonly plugin: { readonly key: string; readonly version: string };
  readonly viewer: GcsPluginViewer;
  /** Limba vizitatorului (`ro`, `en`, `de`, `es`, `fr`, `ru`). */
  readonly locale: string;
  /** Un text din `lang/<limbă>.json` al pluginului (cu `{param}`); lipsă → engleza, apoi cheia. */
  t(key: string, params?: Record<string, string | number>): string;
  /** Escapează text pentru HTML. */
  escape(text: string): string;
  readonly settings: { get<T = unknown>(key: string): T; all(): Record<string, unknown> };
  /** Permisiunile declarate de plugin (`view`, nu `plugin.<cheie>.view`), pentru vizitatorul curent. */
  readonly permissions: { can(permission: string): Promise<boolean> };
  /** SQL parametrizat (`$1`, `$2`…), în schema proprie a pluginului (capabilitatea `db`). */
  readonly db: {
    query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
    execute(sql: string, params?: unknown[]): Promise<number>;
    /** Mai multe instrucțiuni într-o singură tranzacție; întoarce numărul de rânduri afectate de fiecare. */
    batch(statements: { sql: string; params?: unknown[] }[]): Promise<number[]>;
  };
  /** Citiri publice, cu permisiunile vizitatorului curent. */
  readonly api: {
    users: { get(ids: string[]): Promise<GcsPluginUser[]> };
    topics: { get(id: number): Promise<GcsPluginTopic | null>; recent(limit?: number): Promise<GcsPluginTopic[]> };
    posts: { get(id: number): Promise<GcsPluginPost | null>; recent(limit?: number): Promise<GcsPluginPost[]> };
    forums: { list(): Promise<GcsPluginForum[]> };
    stats(): Promise<GcsPluginStats>;
    /** Planurile VIP, abonamentele active (≤ 100 de useri) și membrii VIP (online întâi). */
    vip: {
      plans(): Promise<GcsPluginVipPlan[]>;
      status(userIds: string[]): Promise<GcsPluginVipStatus[]>;
      members(opts?: { limit?: number }): Promise<GcsPluginVipMember[]>;
    };
  };
  /** Aspectul membrilor (capabilitatea `appearance`): `set` validează tot (o eroare numește câmpurile); `null` îl șterge. */
  readonly members: {
    appearance: {
      set(userId: string, appearance: GcsMemberAppearance | null): Promise<void>;
      get(userIds: string[]): Promise<Record<string, GcsMemberAppearance>>;
      clear(): Promise<number>;
      /**
       * Stilurile CSS scrise de un admin (GCS ≥ 0.7.1): doar declarații, `::before { }`, `::after { }` și `@keyframes`;
       * nucleul le verifică, le închide pe clasa stilului și pe numele membrilor care le aleg și le oprește animațiile
       * sub reduced-motion. `set` doar din rutele / paginile ACP ale pluginului (altfel `acp_required`); `null` șterge.
       */
      styles: {
        check(kind: "name" | "banner", key: string, css: string): Promise<GcsCustomStyleResult>;
        set(kind: "name" | "banner", key: string, css: string | null): Promise<GcsCustomStyleResult>;
        list(kind?: "name" | "banner"): Promise<{ kind: "name" | "banner"; key: string; css: string; className: string; updatedAt: string }[]>;
      };
    };
  };
  /**
   * Fișierele media (capabilitatea `media`). Se încarcă doar prin formulare `multipart` spre o rută API; un fișier nou e
   * în așteptare până la `keep` (altfel se șterge după 6 ore).
   */
  readonly media: {
    keep(ids: string[]): Promise<number>;
    get(ids: string[]): Promise<GcsPluginMediaInfo[]>;
    list(opts?: { kind?: "image" | "video" | "audio"; limit?: number; offset?: number }): Promise<GcsPluginMediaInfo[]>;
    delete(ids: string[]): Promise<number>;
    usage(): Promise<{ files: number; bytes: number }>;
  };
  /** Cache în Redis, în spațiul de nume al pluginului (valori JSON ≤ 64 KB, TTL ≤ o zi). */
  readonly cache: {
    get<T = unknown>(key: string): Promise<T | null>;
    set(key: string, value: GcsPluginJson, ttlSeconds?: number): Promise<void>;
    delete(key: string): Promise<void>;
  };
  /** Jurnalul pluginului (ACP → pagina pluginului → Jurnal). */
  readonly log: { info(message: string, data?: GcsPluginJson): void; warn(message: string, data?: GcsPluginJson): void; error(message: string, data?: GcsPluginJson): void };
  readonly jobs: { enqueue(job: string, data?: Record<string, GcsPluginJson>): Promise<void> };
  /** Cereri HTTP(S) spre alte site-uri (capabilitatea `http-out`); adresele private și locale sunt refuzate. */
  readonly http: { fetch(url: string, init?: GcsPluginFetchInit): Promise<GcsPluginFetchResponse> };
}

export type GcsPluginPageInput = { path: string; params: Record<string, string>; query: Record<string, string> };
export type GcsPluginPageResult = { title?: string; html?: GcsPluginHtml; status?: 200 | 403 | 404; redirect?: string };

export type GcsPluginApiRequest = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  params: Record<string, string>;
  query: Record<string, string>;
  /**
   * JSON sau, pentru formulare, câmpurile (numele repetate devin liste); un câmp de fișier conține
   * `GcsPluginMediaInfo` (în așteptare) sau `GcsPluginMediaError`.
   */
  body: GcsPluginJson;
  /** Cererea vine dintr-un formular (urlencoded sau multipart): răspunsul poate fi `{ redirect }`. */
  form: boolean;
  /** Ruta e a ACP-ului (`acp` în manifest): poarta ACP și dreptul pe secțiunea pluginului au fost verificate. */
  acp: boolean;
};
/** `redirect`: o pagină a pluginului (`/p/<cheie>…` sau `/admin/plugins/<cheie>…`), unde ajunge un formular (303). */
export type GcsPluginApiResponse = { status?: number; body?: GcsPluginJson; redirect?: string };

export type GcsPluginEventPayload = Record<string, string | number | boolean | null | (string | number | boolean | null)[]>;
export type GcsPluginEvent = { name: string; payload: GcsPluginEventPayload };

/** Datele filtrului `post.before_save`: topic nou, răspuns sau editare. `content` e documentul editorului (JSON). */
export type GcsPostFilterData = {
  kind: "topic" | "reply" | "edit";
  title: string | null;
  content: GcsPluginJson;
  forumId: number;
  topicId: number | null;
  authorId: string | null;
};
/** Un filtru întoarce datele (modificate sau nu), nimic (neschimbate) sau `{ reject: "motiv" }`. */
export type GcsFilterResult<T> = T | { reject: string } | undefined | void;

type Awaitable<T> = T | Promise<T>;

export type GcsWidgetInput = { config: Record<string, GcsPluginJson>; page: string; zone: string };

/** Forum v2: un nod al forumului primit la punctele forumului, cu valorile salvate ale taburilor pluginului (`data`). */
export type GcsPluginForumNode = {
  id: number;
  type: "CATEGORY" | "FORUM" | "QA" | "LINK" | "PAGE";
  parentId: number | null;
  name: string;
  slug: string;
  data: Record<string, GcsPluginJson>;
};
/** Datele punctului `forum.list` (GCS ≥ 0.9.0): toate nodurile listei, o dată pe pagină. */
export type GcsPluginForumListInput = { surface: "index" | "forum"; nodes: GcsPluginForumNode[] };
/**
 * Ce pune pluginul pe un nod din listă: HTML lângă titlu (`title`), sub descriere (`meta`), în banda unei categorii
 * (`header`) și stilul rândului / categoriei: clase `gcsp-*` (sau modificatorii nucleului, ex. `gcs-forumRow--titleCaps`)
 * și variabile `--gcsp-*` / `--gcs-forum-*` (culori hex, numere, `url("/plugins/<cheie>/media/…")`, gradiente simple).
 * Rândul primește și clasa containerului pluginului, deci CSS-ul pluginului (`client.styles`) ajunge în el.
 */
export type GcsPluginForumListSlots = {
  title?: GcsPluginHtml;
  meta?: GcsPluginHtml;
  header?: GcsPluginHtml;
  style?: { classes?: string[]; vars?: Record<string, string> };
};
export type GcsPluginForumListResult = Record<string, GcsPluginForumListSlots>;

/** Ce întoarce un punct de extensie: HTML, harta lui `forum.list` sau nimic. */
export type GcsPluginHookResult = GcsPluginHtml | GcsPluginForumListResult | null;

/** Ce poate exporta `server.mjs`. Cheile corespund declarațiilor din `plugin.json`. */
export interface GcsPluginDefinition {
  /** Widget-urile, după cheia din `widgets[].key`. */
  widgets?: Record<string, (input: GcsWidgetInput, ctx: GcsPluginContext) => Awaitable<GcsPluginHtml>>;
  /** Paginile de pe site (`/p/<cheie>/…`), după calea din `routes.pages[].path` (ex. `/`, `/item/:id`). */
  pages?: Record<string, (input: GcsPluginPageInput, ctx: GcsPluginContext) => Awaitable<GcsPluginPageResult>>;
  /** Paginile din ACP (`/admin/plugins/<cheie>/…`), după `routes.acp[].path`. */
  acp?: Record<string, (input: GcsPluginPageInput, ctx: GcsPluginContext) => Awaitable<GcsPluginPageResult>>;
  /** Rutele API (`/api/plugins/<cheie>/…`), după `routes.api[].path`. */
  api?: Record<string, (request: GcsPluginApiRequest, ctx: GcsPluginContext) => Awaitable<GcsPluginApiResponse>>;
  /** Listenerii evenimentelor din `events`. */
  events?: Record<string, (event: GcsPluginEvent, ctx: GcsPluginContext) => Awaitable<void>>;
  /** Filtrele din `filters[].point`. */
  filters?: { "post.before_save"?: (data: GcsPostFilterData, ctx: GcsPluginContext) => Awaitable<GcsFilterResult<GcsPostFilterData>> };
  /**
   * Punctele de extensie din `hooks[].point` (ex. `postbit.after_fields`). Forum v2 (GCS ≥ 0.9.0): `forum.list`
   * (`GcsPluginForumListInput` → `GcsPluginForumListResult`), `forum.page` (`{ forumId, data }`), `topic.bar`
   * (`{ topicId, forumId, data }`) și `forum.edit` (`{ tab, forumId, data }`, corpul unui tab din `forumTabs`) → HTML.
   */
  hooks?: Record<string, (data: Record<string, GcsPluginJson>, ctx: GcsPluginContext) => Awaitable<GcsPluginHookResult>>;
  /** Joburile din `jobs[].key`. */
  jobs?: Record<string, (data: Record<string, GcsPluginJson>, ctx: GcsPluginContext) => Awaitable<void>>;
}

/** Declară pluginul: `export default definePlugin({ widgets: { … }, pages: { … } })`. */
export function definePlugin<T extends GcsPluginDefinition>(definition: T): T {
  return definition;
}
