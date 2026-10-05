/** Unește clasele CSS, ignorând valorile false/goale. */
export function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}
