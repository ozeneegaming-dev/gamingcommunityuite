// Tipurile release-ului de redistribuire (folosite de testele din TypeScript).

export declare const RELEASE_EXCLUDES: RegExp[];
export declare function isShipped(rel: string): boolean;
export declare const RELEASE_BRANDING: RegExp[];
export declare const CLIENT_REWRITES: Record<string, (source: string) => string>;
export declare function brandingIssues(files: Iterable<[string, Uint8Array]>): string[];
export declare function sha256(data: Uint8Array | string): string;
export declare function checksumsFile(files: Iterable<[string, Uint8Array]>): string;
export declare function projectFiles(root?: string): string[];
export declare function releaseFiles(opts: { root?: string; version: string; files?: string[] }): Map<string, Buffer>;
export declare function writeTarGz(entries: { name: string; data: Buffer }[]): Buffer;
export declare function writeZip(entries: { name: string; data: Buffer }[]): Buffer;
export declare const PREMIUM_PLUGINS: { app: string; build: string[]; dist: string; pattern: RegExp }[];
export declare function buildRelease(opts?: { root?: string; version?: string; out?: string; premium?: boolean; files?: string[] }): {
  outDir: string;
  tarGz: string;
  zip: string;
  files: number;
  premium: string[];
};
