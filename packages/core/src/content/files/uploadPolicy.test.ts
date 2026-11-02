import { describe, expect, test } from "vitest";
import { extensionListError, fileExtension, GCS_DEFAULT_ALLOWED_EXTENSIONS, parseExtensionList, uploadTypeError } from "./uploadPolicy";

const ALL = parseExtensionList(GCS_DEFAULT_ALLOWED_EXTENSIONS);
const JPEG = { mime: "image/jpeg", ext: "jpg" };
const ZIP = { mime: "application/zip", ext: "zip" };
const PDF = { mime: "application/pdf", ext: "pdf" };

describe("lista extensiilor permise", () => {
  test("se normalizează (punct, majuscule, aliasuri) și fără dubluri", () => {
    expect(parseExtensionList(".JPG, jpeg\npng;  .Png")).toEqual(["jpg", "png"]);
    expect(fileExtension("Poză.JPEG")).toBe("jpg");
    expect(fileExtension("fara-extensie")).toBe("");
  });

  test("lista implicită e validă; extensiile periculoase sau necunoscute sunt refuzate la salvare", () => {
    expect(extensionListError(GCS_DEFAULT_ALLOWED_EXTENSIONS)).toBeNull();
    expect(extensionListError("png, exe")).toBe("dangerous_extension");
    expect(extensionListError("png, .svg")).toBe("dangerous_extension");
    expect(extensionListError("png, psd")).toBe("unknown_extension");
    expect(extensionListError("")).toBeNull();
  });
});

describe("uploadTypeError: extensia ȘI tipul real", () => {
  test("un fișier permis, cu extensia potrivită, trece", () => {
    expect(uploadTypeError("harta.jpg", JPEG, ALL, false)).toBeNull();
    expect(uploadTypeError("config.zip", ZIP, ALL, false)).toBeNull();
    expect(uploadTypeError("autoexec.cfg", null, ALL, true)).toBeNull();
    // Fără extensie (ex. o imagine lipită din clipboard): decide tipul real.
    expect(uploadTypeError("image", JPEG, ALL, false)).toBeNull();
  });

  test("extensiile periculoase sunt refuzate mereu, chiar dacă octeții sunt o imagine sau adminul le-ar permite", () => {
    expect(uploadTypeError("shell.php", JPEG, ALL, false)).toBe("dangerous_type");
    expect(uploadTypeError("pagina.html", null, ["html", ...ALL], true)).toBe("dangerous_type");
    expect(uploadTypeError("setup.exe", { mime: "application/x-msdownload", ext: "exe" }, ["exe"], false)).toBe("dangerous_type");
  });

  test("tipul real trebuie să fie cunoscut și permis de listă", () => {
    expect(uploadTypeError("a.bin", { mime: "application/x-msdownload", ext: "exe" }, ALL, false)).toBe("unsupported_type");
    expect(uploadTypeError("arhiva.zip", ZIP, ["jpg", "png"], false)).toBe("extension_not_allowed");
    expect(uploadTypeError("log.txt", null, ["jpg"], true)).toBe("extension_not_allowed");
  });

  test("o extensie care nu se potrivește cu tipul real e refuzată (în afară de imaginile redenumite)", () => {
    expect(uploadTypeError("raport.pdf", ZIP, ALL, false)).toBe("type_mismatch");
    expect(uploadTypeError("poza.png", ZIP, ALL, false)).toBe("type_mismatch");
    expect(uploadTypeError("document.zip", PDF, ALL, false)).toBe("type_mismatch");
    // Un JPEG numit .png se recodează oricum (formatul real decide).
    expect(uploadTypeError("poza.png", JPEG, ALL, false)).toBeNull();
  });

  test("textele cer extensia de text și conținut UTF-8", () => {
    expect(uploadTypeError("x.cfg", null, ALL, false)).toBe("unsupported_type");
    expect(uploadTypeError("nota.docx", null, ALL, true)).toBe("unsupported_type");
  });
});
