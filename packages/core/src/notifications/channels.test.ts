import { describe, expect, test } from "vitest";
import { cleanDefaults, cleanOverride, codeChannels, deliversNothing, effectiveChannels, parseLocks, parseOverride, resolveDelivery, typeDefaults } from "./channels";

const code = codeChannels({ defaultEmail: "DIGEST" });

describe("canalele notificărilor: valorile din cod", () => {
  test("din `defaultEmail`: site și toast pornite, push doar important, emailul pornit / oprit cu modul lui", () => {
    expect(code).toEqual({ site: "on", toast: "on", email: "on", push: "important", emailMode: "daily" });
    expect(codeChannels({ defaultEmail: "INSTANT" })).toMatchObject({ email: "on", emailMode: "instant" });
    expect(codeChannels({ defaultEmail: "OFF" })).toMatchObject({ email: "off", emailMode: "daily" });
    expect(codeChannels({})).toMatchObject({ email: "off" });
  });

  test("`channels` din declarație înlocuiește valorile derivate (ex. rezumatul săptămânal)", () => {
    expect(codeChannels({ channels: { toast: "off", push: "off", emailMode: "weekly" } })).toEqual({ site: "on", toast: "off", email: "off", push: "off", emailMode: "weekly" });
  });

  test("valorile salvate se validează: stările și modurile necunoscute dispar", () => {
    expect(parseOverride({ site: "off", toast: "maybe", email: "important", push: 1, emailMode: "hourly" })).toEqual({ site: "off", email: "important" });
    expect(parseOverride(null)).toEqual({});
    expect(parseLocks({ site: "forced", email: "disabled", push: "x" })).toEqual({ site: "forced", email: "disabled" });
    expect(parseLocks([])).toEqual({});
  });
});

describe("rezolvarea: valori implicite, blocări, alegerile membrului, trei stări", () => {
  const defaults = typeDefaults(code, { channels: { toast: "off" }, locks: { push: "disabled", site: "forced" } });

  test("valorile implicite din ACP vin peste cele din cod; blocările se aplică peste alegerea membrului", () => {
    expect(defaults).toMatchObject({ site: "on", toast: "off", email: "on", push: "important", locks: { push: "disabled", site: "forced" } });
    const eff = effectiveChannels(defaults, { site: "off", push: "on", toast: "on", email: "off" });
    expect(eff).toEqual({ site: "on", toast: "on", email: "off", push: "off", emailMode: "daily" });
  });

  test("pornit trece mereu, „doar important” doar pentru o notificare importantă, oprit niciodată", () => {
    const d = typeDefaults(code, { channels: { site: "on", toast: "important", email: "off", push: "important" } });
    expect(resolveDelivery(d, null, { important: false })).toEqual({ site: true, toast: false, push: false, email: null });
    expect(resolveDelivery(d, null, { important: true })).toEqual({ site: true, toast: true, push: true, email: null });
    expect(resolveDelivery(d, { email: "important", emailMode: "instant" }, { important: true }).email).toBe("instant");
    expect(resolveDelivery(d, { email: "important", emailMode: "instant" }, { important: false }).email).toBeNull();
  });

  test("„Oprește toate emailurile” (ACP) oprește și un email forțat; celelalte canale rămân", () => {
    const forced = typeDefaults(code, { locks: { email: "forced" } });
    expect(resolveDelivery(forced, { email: "off" }, { important: false }).email).toBe("daily");
    expect(resolveDelivery(forced, null, { important: false, emailsOff: true })).toEqual({ site: true, toast: true, push: false, email: null });
  });

  test("fără niciun canal nu se creează nimic", () => {
    const none = typeDefaults(code, { channels: { site: "off", toast: "off", email: "off", push: "off" } });
    expect(deliversNothing(resolveDelivery(none, null, { important: true }))).toBe(true);
    expect(deliversNothing(resolveDelivery(none, { push: "on" }, { important: false }))).toBe(false);
  });
});

describe("salvarea", () => {
  const defaults = typeDefaults(code, { locks: { email: "disabled", site: "forced" } });

  test("membrul: fără canalele blocate și fără valorile egale cu cele implicite", () => {
    expect(cleanOverride(defaults, { site: "off", toast: "on", email: "on", push: "on", emailMode: "weekly" })).toEqual({ push: "on" });
    expect(cleanOverride(typeDefaults(code), { toast: "important", emailMode: "weekly" })).toEqual({ toast: "important", emailMode: "weekly" });
    expect(cleanOverride(typeDefaults(code), { toast: "on", emailMode: "daily" })).toEqual({});
  });

  test("ACP: canalele lipsă rămân cele din cod, blocările se validează", () => {
    expect(cleanDefaults(code, { channels: { push: "off", site: "nope" }, locks: { push: "forced", toast: "?" } })).toEqual({
      channels: { site: "on", toast: "on", email: "on", push: "off", emailMode: "daily" },
      locks: { push: "forced" },
    });
  });
});
