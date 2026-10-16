import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useMentionInput } from "./useMentionInput";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ json: async () => ({ users: [{ id: "u2", name: "Bogdan", image: null, nameKey: "member", online: false, clan: null }], groups: [] }) })),
  );
});

const labels = { empty: "Niciun membru", group: "Grup", online: "Online" };

function Field({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial);
  const m = useMentionInput<HTMLInputElement>({ value, onValue: setValue, labels });
  return (
    <div className="gcs-mentionAnchor">
      <input
        ref={m.ref}
        aria-label="câmp"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          m.onText(e.target.value, e.target.selectionStart ?? e.target.value.length);
        }}
        onKeyDown={(e) => void m.onKeyDown(e)}
      />
      {m.popup}
    </div>
  );
}

test("alegerea pune cursorul după mențiune imediat (nu într-un cadru de animație care ar muta tastele scrise între timp)", async () => {
  const raf = vi.fn();
  vi.stubGlobal("requestAnimationFrame", raf);
  render(<Field initial="Salut  final" />);
  const input = screen.getByLabelText<HTMLInputElement>("câmp");
  input.focus();
  // „@Bo” scris în mijlocul textului (după „Salut ”).
  input.setSelectionRange(6, 6);
  fireEvent.change(input, { target: { value: "Salut @Bo final", selectionStart: 9, selectionEnd: 9 } });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });
  expect(screen.getByTestId("gcs-mention-popup")).toBeTruthy();
  fireEvent.keyDown(input, { key: "Enter" });
  expect(input.value).toBe("Salut @Bogdan  final");
  // Cursorul e deja după „@Bogdan ”, înainte de orice tastă următoare.
  expect(input.selectionStart).toBe(14);
  expect(input.selectionEnd).toBe(14);
  expect(document.activeElement).toBe(input);
  expect(raf).not.toHaveBeenCalled();
});
