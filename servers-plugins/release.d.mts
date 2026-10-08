// Tipurile pasului de release (folosite de testul manifestului din TypeScript).

export declare function sourceFiles(root: string, game: "cs16" | "cs2"): string[];
export declare function fileSha256(buf: Buffer | string): string;
export declare function sourcesSha256(root: string, game: "cs16" | "cs2"): string;
export declare function sourceVersions(root: string): {
  cs16: { version: string | null; id: string | null };
  cs2: { version: string | null; clientVersion: string | null; id: string | null };
};
export declare const RELEASE_LAYOUT: Record<"cs16" | "cs2", Record<string, string>>;
