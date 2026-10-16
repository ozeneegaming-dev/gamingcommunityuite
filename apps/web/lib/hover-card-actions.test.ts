import { describe, expect, test } from "vitest";
import { hoverCardActionProviders, registerHoverCardActions, unregisterHoverCardActions } from "./hover-card-actions";

describe("slotul de extensie al hover card-ului (`hoverCardActions`)", () => {
  test("furnizorii, în ordine; o cheie înregistrată din nou își înlocuiește furnizorul; scoaterea", () => {
    const A = () => null;
    const B = () => null;
    const C = () => null;
    registerHoverCardActions("test.b", B, 20);
    registerHoverCardActions("test.a", A, 10);
    registerHoverCardActions("test.c", C);
    expect(hoverCardActionProviders().filter((p) => p.key.startsWith("test.")).map((p) => p.key)).toEqual(["test.a", "test.b", "test.c"]);
    registerHoverCardActions("test.b", C, 5);
    expect(hoverCardActionProviders().filter((p) => p.key.startsWith("test."))[0]).toEqual({ key: "test.b", Provider: C });
    for (const k of ["test.a", "test.b", "test.c"]) unregisterHoverCardActions(k);
    expect(hoverCardActionProviders().filter((p) => p.key.startsWith("test."))).toEqual([]);
  });
});
