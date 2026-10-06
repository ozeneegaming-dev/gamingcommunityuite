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
 * HTML randat de plugin: un șir sau `{ html }`. Trece prin sanitizer (listă albă de taguri și atribute, fără scripturi,
 * `style`, `id` sau formulare; clase `gcsp-*`). `<gcs-icon name="fa-solid fa-star"></gcs-icon>` devine iconița Font Awesome.
 * `{ template, data }` e rezervat motorului de șabloane.
 */
export type GcsPluginHtml = string | { html: string } | { template: string; data?: Record<string, GcsPluginJson> };

/** Vizitatorul pentru care rulează apelul (în evenimente și joburi: vizitator anonim). */
export type GcsPluginViewer = { userId: string | null; isGuest: boolean };

export type GcsPluginUser = {
  id: string;
  name: string;
  /** Cheia grupului principal (stilul numelui: clasa `gcs-name--<cheie>`). */
  groupKey: string;
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
  body: GcsPluginJson;
};
export type GcsPluginApiResponse = { status?: number; body?: GcsPluginJson };

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
  /** Punctele de extensie din `hooks[].point` (ex. `postbit.after_fields`). */
  hooks?: Record<string, (data: Record<string, GcsPluginJson>, ctx: GcsPluginContext) => Awaitable<GcsPluginHtml | null>>;
  /** Joburile din `jobs[].key`. */
  jobs?: Record<string, (data: Record<string, GcsPluginJson>, ctx: GcsPluginContext) => Awaitable<void>>;
}

/** Declară pluginul: `export default definePlugin({ widgets: { … }, pages: { … } })`. */
export function definePlugin<T extends GcsPluginDefinition>(definition: T): T {
  return definition;
}
