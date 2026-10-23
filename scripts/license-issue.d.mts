// Tipurile emiterii licențelor (folosite de testele din TypeScript).

export declare const PREMIUM_APPS: string[];
export type GcsIssuedLicense = {
  v: 1;
  kid: string;
  id: string;
  licensee: string;
  domains: string[];
  package: "standard";
  apps: string[];
  issuedAt: string;
  expiresAt: string | null;
};
export declare function issueLicense(opts: {
  key?: string;
  keyId?: string;
  licensee?: string;
  domains?: string[];
  apps?: string[];
  expires?: string;
  id?: string;
  now?: Date;
}): { token: string; license: GcsIssuedLicense };
export declare function parseIssueArgs(argv: readonly string[]): {
  key?: string;
  keyId: string;
  licensee?: string;
  domains: string[];
  apps: string[];
  expires?: string;
  id?: string;
  out?: string;
};
