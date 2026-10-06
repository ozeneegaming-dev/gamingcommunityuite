/**
 * Erorile de business (spec §16). Mesajele afișate vin din `messages/{ro,en}.json` pe baza lui `code`;
 * `params` completează mesajul, iar `fields` leagă erorile de validare de câmpurile formularului.
 */
export type GcsErrorPayload = {
  code: string;
  status: number;
  params?: Record<string, string>;
  fields?: Record<string, string>;
};

export type GcsResult<T> = { ok: true; data: T } | { ok: false; error: GcsErrorPayload };

const GCS_ERROR_BRAND = Symbol.for("gcs.error");

export class GcsError extends Error {
  readonly code: string;
  readonly status: number;
  readonly params?: Record<string, string>;

  /** Marca erorilor GamingCommunitySuite, comună tuturor copiilor modulului (vezi `Symbol.hasInstance`). */
  readonly [GCS_ERROR_BRAND] = true;

  constructor(code: string, status: number, params?: Record<string, string>) {
    super(code);
    this.name = new.target.name;
    this.code = code;
    this.status = status;
    if (params) this.params = params;
  }

  /** Codul erorilor unei subclase (`forbidden`, `not_found`…); `undefined` pentru `GcsError` însăși. */
  static readonly errorCode: string | undefined = undefined;

  /**
   * `instanceof` după marcă și cod, nu după identitatea clasei: în Next.js, `@gcs/core` poate fi încărcat
   * în mai multe copii (câte una per bundle), iar o eroare aruncată de o copie trebuie recunoscută de alta.
   * Numele claselor nu se pot folosi: build-ul de producție le minifică.
   */
  static override [Symbol.hasInstance](value: unknown): boolean {
    if (typeof value !== "object" || value === null || (value as Record<symbol, unknown>)[GCS_ERROR_BRAND] !== true) {
      return false;
    }
    const code = (this as unknown as { errorCode?: string }).errorCode;
    return code === undefined || (value as GcsError).code === code;
  }

  toPayload(): GcsErrorPayload {
    const payload: GcsErrorPayload = { code: this.code, status: this.status };
    if (this.params) payload.params = this.params;
    return payload;
  }
}

export class GcsNotFound extends GcsError {
  static override readonly errorCode = "not_found";
  constructor(params?: Record<string, string>) {
    super("not_found", 404, params);
  }
}

export class GcsForbidden extends GcsError {
  static override readonly errorCode = "forbidden";
  constructor(params?: Record<string, string>) {
    super("forbidden", 403, params);
  }
}

export class GcsValidationError extends GcsError {
  static override readonly errorCode = "validation";
  readonly fields: Record<string, string>;

  constructor(fields: Record<string, string>, params?: Record<string, string>) {
    super("validation", 422, params);
    this.fields = fields;
  }

  override toPayload(): GcsErrorPayload {
    return { ...super.toPayload(), fields: this.fields };
  }
}

export class GcsRateLimited extends GcsError {
  static override readonly errorCode = "rate_limited";
  constructor(params?: Record<string, string>) {
    super("rate_limited", 429, params);
  }
}

export class GcsConflict extends GcsError {
  static override readonly errorCode = "conflict";
  constructor(params?: Record<string, string>) {
    super("conflict", 409, params);
  }
}

/** Rulează `fn` și transformă un `GcsError` în `{ ok: false }`. Orice altă eroare e aruncată mai departe. */
export async function toResult<T>(fn: () => Promise<T>): Promise<GcsResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    if (error instanceof GcsError) return { ok: false, error: error.toPayload() };
    throw error;
  }
}
