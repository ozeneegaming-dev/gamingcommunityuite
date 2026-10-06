/** Pagina la care revine userul după login / înregistrare din popup (specul etapei 5): reținută la click pe „Autentificare”. */
const KEY = "gcs-auth-return";

export function rememberAuthReturn(): void {
  try {
    const here = `${window.location.pathname}${window.location.search}`;
    if (!/^\/(login|register)(\/|$|\?)/.test(here)) sessionStorage.setItem(KEY, here);
  } catch {
    // Fără sessionStorage: se revine la pagina principală.
  }
}

export function authReturnPath(): string {
  try {
    const path = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    if (path && path.startsWith("/") && !path.startsWith("//") && !/^\/(login|register)/.test(path)) return path;
  } catch {
    // ignorat
  }
  return "/";
}
