/**
 * Căile disponibile și în mentenanță: login-ul (staff-ul trebuie să poată intra), autentificarea și health-check-ul.
 * Plus endpoint-ul intern al consolei (`gcs maintenance off`, `gcs plugins:disable-all`): n-are sesiune, dar își
 * verifică singur token-ul HMAC (`GCS_SECRET`), deci mentenanța nu trebuie să-l blocheze. Doar calea exactă.
 */
const MAINTENANCE_EXEMPT = [/^\/login$/, /^\/api\/auth\//, /^\/api\/health$/, /^\/maintenance$/, /^\/gcs-names\.css$/, /^\/api\/internal\/cli$/];

/** Calea rămâne accesibilă tuturor cât timp site-ul e în mentenanță. */
export function isMaintenanceExempt(path: string): boolean {
  return MAINTENANCE_EXEMPT.some((r) => r.test(path));
}
