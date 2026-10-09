import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { GcsImageViewer, type GcsImageViewerLabels } from "./GcsImageViewer";

afterEach(() => cleanup());

const labels: GcsImageViewerLabels = {
  dialog: "Vizualizator de imagini",
  close: "Închide",
  prev: "Imaginea anterioară",
  next: "Imaginea următoare",
  zoomIn: "Mărește",
  zoomOut: "Micșorează",
  original: "Deschide originalul",
  download: "Descarcă",
  thumbnails: "Miniaturi",
  counter: "{current} din {total}",
  by: "de {name}",
  source: "Vezi postarea",
};

const images = [
  { src: "/files/a", alt: "A", caption: { author: "Krypt", date: "2026-10-01T10:00:00.000Z", href: "/topic/1#post-5" } },
  { src: "/files/b", alt: "B", original: "/files/b?full=1" },
  { src: "/files/c", alt: "C" },
];

describe("GcsImageViewer", () => {
  test("dialog accesibil cu imaginea, numărătoarea, legenda, originalul și descărcarea", () => {
    render(<GcsImageViewer images={images} index={0} onClose={() => {}} labels={labels} formatDate={() => "1 oct."} />);
    const dialog = screen.getByRole("dialog", { name: "Vizualizator de imagini" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(screen.getByTestId("gcs-viewer-image").getAttribute("src")).toBe("/files/a");
    expect(screen.getByTestId("gcs-viewer-counter").textContent).toBe("1 din 3");
    expect(screen.getByTestId("gcs-viewer-caption").textContent).toContain("de Krypt");
    expect(screen.getByRole("link", { name: "Vezi postarea" }).getAttribute("href")).toBe("/topic/1#post-5");
    expect(screen.getByRole("link", { name: "Deschide originalul" }).getAttribute("href")).toBe("/files/a");
    expect(screen.getByRole("link", { name: "Descarcă" }).hasAttribute("download")).toBe(true);
    // Focusul intră în dialog (pe butonul de închidere).
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Închide" }));
  });

  test("săgețile tastaturii și butoanele trec la imaginea următoare / anterioară, circular; miniaturile o aleg", () => {
    render(<GcsImageViewer images={images} index={0} onClose={() => {}} labels={labels} />);
    const dialog = screen.getByRole("dialog");
    fireEvent.keyDown(dialog, { key: "ArrowRight" });
    expect(screen.getByTestId("gcs-viewer-image").getAttribute("src")).toBe("/files/b");
    expect(screen.getByRole("link", { name: "Deschide originalul" }).getAttribute("href")).toBe("/files/b?full=1");
    fireEvent.click(screen.getByRole("button", { name: "Imaginea anterioară" }));
    fireEvent.click(screen.getByRole("button", { name: "Imaginea anterioară" }));
    expect(screen.getByTestId("gcs-viewer-image").getAttribute("src")).toBe("/files/c");
    fireEvent.click(screen.getByRole("button", { name: "1 din 3" }));
    expect(screen.getByTestId("gcs-viewer-image").getAttribute("src")).toBe("/files/a");
    expect(screen.getByRole("button", { name: "1 din 3" }).getAttribute("aria-current")).toBe("true");
  });

  test("mărirea cu butonul și tasta 0 (revenire); Escape închide", () => {
    const onClose = vi.fn();
    render(<GcsImageViewer images={images} index={1} onClose={onClose} labels={labels} />);
    fireEvent.click(screen.getByRole("button", { name: "Mărește" }));
    expect(Number(screen.getByTestId("gcs-viewer-image").getAttribute("data-scale"))).toBeGreaterThan(1);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "0" });
    expect(screen.getByTestId("gcs-viewer-image").getAttribute("data-scale")).toBe("1.00");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("o singură imagine: fără săgeți, fără miniaturi, fără numărătoare", () => {
    render(<GcsImageViewer images={[images[2]!]} index={0} onClose={() => {}} labels={labels} />);
    expect(screen.queryByRole("button", { name: "Imaginea următoare" })).toBeNull();
    expect(screen.queryByRole("navigation", { name: "Miniaturi" })).toBeNull();
    expect(screen.getByTestId("gcs-viewer-counter").textContent).toBe("");
  });
});
