// Tipurile serverului de joc fals (folosit de testele GCS din TypeScript).

export declare const BRIDGE_BASE_PATH: string;

export type MockRequest = { method: string; path: string; headers: Record<string, string>; body: string | Uint8Array };
export type MockResponse = { status: number; headers?: Record<string, string>; body: string | null };
export type MockTransport = (req: MockRequest) => Promise<MockResponse>;

export type MockPlayerRef = { auth: string; steam?: boolean; name: string; ip?: string; team?: string; score?: number; time?: number; flags?: string; permissions?: string[]; groups?: string[] };
export type MockPlainResponse = { status: number; json: any; headers: Record<string, string> };
export type MockEvent = { id: string; type: string; at: number; [field: string]: unknown };
export type MockEventResult = { id: string; status: "ok" | "duplicate" | "rejected"; error?: string; note?: string; sanctionId?: number };

export declare function parseKey(token: string): { keyId: string; signingKey: string };
export declare function signHeaders(
  key: { keyId: string; signingKey: string },
  method: string,
  path: string,
  body: string | Uint8Array,
  timestamp: number,
  alg?: "hmac-sha256" | "sha256-env",
  nonce?: string,
): Record<string, string>;
export declare function httpTransport(baseUrl: string, extraHeaders?: Record<string, string>): MockTransport;
export declare function startA2sResponder(opts?: { port?: number; game?: string; name?: string; map?: string; players?: number; maxPlayers?: number }): Promise<{ port: number; close(): Promise<void> }>;
export declare function mockPlayer(game: string, n: number, extra?: Partial<MockPlayerRef>): MockPlayerRef;

export type MockMixContext = { matchId: string; map: string; players: MockPlayerRef[]; teamA: MockPlayerRef[]; teamB: MockPlayerRef[] };

export declare class GcsMockServer {
  constructor(opts: { token?: string; transport: MockTransport; game?: string; clock?: () => number; alg?: "hmac-sha256" | "sha256-env"; runId?: string; log?: (msg: string) => void });
  key: { keyId: string; signingKey: string } | null;
  token: string | null;
  enrollSecret: string;
  enrollment: string | null;
  readonly runId: string;
  game: string;
  offset: number;
  cursor: number;
  etags: { admins: string | null; vip: string | null };
  now(): number;
  request(method: string, path: string, payload?: unknown, extraHeaders?: Record<string, string>): Promise<{ status: number; json: any; headers: Record<string, string> }>;
  event(type: string, fields?: Record<string, unknown>): MockEvent;
  plain(path: string, payload: unknown): Promise<MockPlainResponse>;
  enroll(opts?: { port?: number; hostname?: string; map?: string; players?: number; maxPlayers?: number }): Promise<MockPlainResponse>;
  enrollStatus(): Promise<MockPlainResponse>;
  waitForKey(opts?: { intervalMs?: number; timeoutMs?: number }): Promise<string>;
  heartbeat(opts?: { map?: string; players?: MockPlayerRef[]; match?: unknown; maxPlayers?: number; modules?: string[]; scores?: { ct: number; t: number }; tv?: Record<string, unknown> }): Promise<any>;
  requestBinary(method: string, path: string, bytes: Uint8Array): Promise<{ status: number; json: any; headers: Record<string, string> }>;
  uploadDemo(opts: { match: string; file: string; bytes: Uint8Array; stopAfter?: number }): Promise<{ status: number; json: any; headers: Record<string, string> }>;
  startMix(opts?: { map?: string; matchId?: string; tv?: Record<string, unknown> }): Promise<MockMixContext>;
  finishMix(ctx: MockMixContext, opts?: { rounds?: number; status?: "ended" | "aborted" }): Promise<{ matchId: string; score: { A: number; B: number }; result: MockEventResult }>;
  send(events: MockEvent[]): Promise<MockEventResult[]>;
  pullAdmins(): Promise<any[] | null>;
  pullVip(): Promise<any[] | null>;
  pullSanctions(): Promise<any[]>;
  check(player: MockPlayerRef): Promise<any>;
  link(player: MockPlayerRef, code: string): Promise<{ status: number; json: any }>;
  matchState(id: string, status: string, opts: { map?: string; round?: number; score?: { A: number; B: number }; teamA: MockPlayerRef[]; teamB: MockPlayerRef[]; stats?: Map<string, Record<string, number>> }): unknown;
  scenarioFull(): Promise<{ matchId: string; score: { A: number; B: number }; players: MockPlayerRef[]; cheater: MockPlayerRef; ended: MockEventResult; ban: MockEventResult; sanctions: any[] }>;
}
