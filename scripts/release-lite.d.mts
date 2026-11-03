// Tipurile pachetului ediției Lite (folosite de testele din TypeScript).

export declare const LITE_TARGETS: Record<"linux-x64-gnu" | "win32-x64", { prisma: string[]; native: (name: string) => boolean }>;
export declare const PLATFORM_PACKAGE: RegExp;
export declare const LITE_EXCLUDES: RegExp[];
export declare const LITE_SERVER_DIR: string;
export declare const LITE_ENGINES_MANIFEST: string;
export declare const PRISMA_UNUSED: RegExp;
export declare function isShippedSource(rel: string): boolean;
export declare function assembleStandalone(standalone: string, dest: string): string;
export declare function swapNatives(
  dest: string,
  target: string,
  opts?: { fetch?: (name: string, version: string, modules: string, tmp: string) => void },
): string[];
export declare function pruneEngines(dest: string, target: string): void;
export declare function slimPrismaClients(dest: string): number;
export declare function shimTurbopackExternals(dest: string): string[];
export declare function dropTraceFiles(dest: string): number;
export declare function dedupeEngines(dest: string): { engines: string[]; links: string[] };
export declare function duplicateFiles(files: Map<string, Buffer>, minBytes?: number): string[][];
export declare function liteReleaseFiles(dest: string, opts: { version: string; root?: string }): Map<string, Buffer>;
export declare function buildLiteRelease(opts?: {
  version?: string;
  out?: string;
  licenseKeys?: Record<string, string>;
  pluginKeys?: Record<string, string>;
  target?: string;
  skipBuild?: boolean;
}): {
  zip: string;
  files: number;
  natives: string[];
  target: string;
  bytes: number;
  unpacked: number;
  engines: { engines: string[]; links: string[] };
  shims: string[];
};
