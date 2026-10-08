import { describe, expect, it } from "vitest";
import { MAP_TEMPLATE_MAX, mapImageOrigins, mapTemplateError, mapTemplateOrigin, mapTemplateUrl } from "./mapImages";

/** Adresele de probă sunt generice (domeniile rezervate pentru exemple), niciodată ale unui site real. */
describe("șablonul de adresă al imaginilor hărților (§13)", () => {
  it("validarea: https cu {map}, fără date de autentificare, lungime limitată", () => {
    expect(mapTemplateError("")).toBeNull();
    expect(mapTemplateError("https://exemplu.com/harti/{map}.jpg")).toBeNull();
    expect(mapTemplateError("https://img.exemplu.com:8443/cs/{map}/poza.webp?v=2")).toBeNull();
    expect(mapTemplateError("https://exemplu.com/harti/?nume={map}")).toBeNull();
    expect(mapTemplateError(42)).toBe("invalid_map_template");
    expect(mapTemplateError("https://exemplu.com/harti/poza.jpg")).toBe("map_template_placeholder");
    // `{map}` în numele host-ului: adresa n-ar mai avea o origine fixă (CSP-ul ar cere `*`).
    expect(mapTemplateError("https://{map}.exemplu.com/poza.jpg")).toBe("map_template_placeholder");
    expect(mapTemplateError("https://user:parola@exemplu.com/{map}.jpg")).toBe("map_template_credentials");
    expect(mapTemplateError("https://{map}@exemplu.com/poza.jpg")).toBe("map_template_credentials");
    expect(mapTemplateError(`https://exemplu.com/${"a".repeat(MAP_TEMPLATE_MAX)}/{map}.jpg`)).toBe("map_template_too_long");
    expect(mapTemplateError("ftp://exemplu.com/{map}.jpg")).toBe("map_template_https");
    expect(mapTemplateError("javascript:alert(1)//{map}")).toBe("map_template_https");
    expect(mapTemplateError("/harti/{map}.jpg")).toBe("invalid_map_template");
    expect(mapTemplateError("https://exemplu.com/har ti/{map}.jpg")).toBe("invalid_map_template");
    expect(mapTemplateError('https://exemplu.com/"{map}".jpg')).toBe("invalid_map_template");
    expect(mapTemplateError("https://exemplu.com/{map}{x}.jpg")).toBe("invalid_map_template");
  });

  it("http doar în dezvoltare", () => {
    expect(mapTemplateError("http://exemplu.com/{map}.jpg")).toBe("map_template_https");
    expect(mapTemplateError("http://exemplu.com/{map}.jpg", { allowHttp: true })).toBeNull();
    expect(mapTemplateUrl("http://exemplu.com/{map}.jpg", "de_dust2")).toBeNull();
    expect(mapTemplateUrl("http://exemplu.com/{map}.jpg", "de_dust2", { allowHttp: true })).toBe("http://exemplu.com/de_dust2.jpg");
  });

  it("adresa unei hărți: numele validat (litere mici), codat; peste tot unde apare {map}", () => {
    expect(mapTemplateUrl("https://exemplu.com/harti/{map}.jpg", "de_dust2")).toBe("https://exemplu.com/harti/de_dust2.jpg");
    expect(mapTemplateUrl("https://exemplu.com/harti/{map}.jpg", " DE_Nuke ")).toBe("https://exemplu.com/harti/de_nuke.jpg");
    expect(mapTemplateUrl("https://exemplu.com/{map}/{map}.png", "aim_map.v2")).toBe("https://exemplu.com/aim_map.v2/aim_map.v2.png");
    expect(mapTemplateUrl("https://exemplu.com/harti/{map}.jpg", "../etc/passwd")).toBeNull();
    expect(mapTemplateUrl("https://exemplu.com/harti/{map}.jpg", "de dust")).toBeNull();
    expect(mapTemplateUrl("https://exemplu.com/harti/{map}.jpg", "..")).toBeNull();
    expect(mapTemplateUrl("", "de_dust2")).toBeNull();
    expect(mapTemplateUrl("https://{map}.exemplu.com/x.jpg", "de_dust2")).toBeNull();
  });

  it("CSP: originile șabloanelor valide, fără dubluri, niciodată `*`", () => {
    expect(mapTemplateOrigin("https://img.exemplu.com/cs/{map}.jpg")).toBe("https://img.exemplu.com");
    expect(mapTemplateOrigin("https://img.exemplu.com:8443/{map}.jpg")).toBe("https://img.exemplu.com:8443");
    expect(mapTemplateOrigin("https://IMG.Exemplu.com:443/{map}.jpg")).toBe("https://img.exemplu.com");
    expect(mapTemplateOrigin("")).toBeNull();
    expect(mapTemplateOrigin("http://img.exemplu.com/{map}.jpg")).toBeNull();
    expect(
      mapImageOrigins(["https://b.exemplu.com/cs/{map}.jpg", "https://a.exemplu.com/{map}.png", "https://b.exemplu.com/cs2/{map}.jpg", "", "https://{map}.exemplu.com/x.jpg", "nu e adresă"]),
    ).toEqual(["https://a.exemplu.com", "https://b.exemplu.com"]);
    expect(mapImageOrigins(["http://dev.exemplu.com/{map}.jpg"], { allowHttp: true })).toEqual(["http://dev.exemplu.com"]);
    expect(mapImageOrigins([])).toEqual([]);
    expect(mapImageOrigins(["https://exemplu.com/{map}.jpg"]).some((o) => o.includes("*"))).toBe(false);
  });
});
