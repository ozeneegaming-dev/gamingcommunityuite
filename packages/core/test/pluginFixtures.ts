import { packPlugin, type GcsPluginSigningKey } from "@gcs/plugin-sdk/pack";

/** Un manifest minimal valid (pentru teste), cu suprascrieri. */
export function testManifest(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    key: "acme.demo",
    name: "Demo",
    version: "1.0.0",
    author: "Acme",
    description: "Un plugin de test",
    icon: "fa-solid fa-star",
    capabilities: ["widgets"],
    widgets: [{ key: "hello", label: "widget.hello", icon: "fa-solid fa-hand" }],
    ...over,
  };
}

const SERVER = `export default { widgets: { hello: () => "<p>Salut</p>" } };\n`;

/** Fișierele unui plugin de test: manifestul, `server.mjs` și textele; `null` șterge un fișier. */
export function testPluginFiles(opts: { manifest?: Record<string, unknown>; files?: Record<string, string | Buffer | null> } = {}): Map<string, Buffer> {
  const files = new Map<string, Buffer>([
    ["plugin.json", Buffer.from(JSON.stringify(opts.manifest ?? testManifest(), null, 2))],
    ["server.mjs", Buffer.from(SERVER)],
    ["lang/ro.json", Buffer.from(JSON.stringify({ widget: { hello: "Salut" } }))],
    ["lang/en.json", Buffer.from(JSON.stringify({ widget: { hello: "Hello" } }))],
  ]);
  for (const [name, data] of Object.entries(opts.files ?? {})) {
    if (data === null) files.delete(name);
    else files.set(name, typeof data === "string" ? Buffer.from(data) : data);
  }
  return files;
}

/** Arhiva unui plugin de test (opțional semnată). */
export function testPluginZip(opts: { manifest?: Record<string, unknown>; files?: Record<string, string | Buffer | null>; sign?: GcsPluginSigningKey } = {}): Buffer {
  return packPlugin(testPluginFiles(opts), opts.sign ? { sign: opts.sign } : {});
}
