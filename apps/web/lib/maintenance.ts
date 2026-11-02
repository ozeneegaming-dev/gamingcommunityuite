/**
 * Căile disponibile și în mentenanță: login-ul (staff-ul trebuie să poată intra), „Am uitat parola” (cererea și pagina
 * parolei noi, ca un membru al staff-ului să-și poată recupera contul), autentificarea și health-check-ul.
 * Plus endpoint-ul intern al consolei (`gcs maintenance off`, `gcs plugins:disable-all`): n-are sesiune, dar își
 * verifică singur token-ul HMAC (`GCS_SECRET`), deci mentenanța nu trebuie să-l blocheze. Doar calea exactă.
 * Și protocolul serverelor de joc (puntea): fiecare cerere e semnată cu cheia serverului, iar adminii și bannurile de pe
 * servere trebuie să meargă și cât timp site-ul e în mentenanță.
 */
const MAINTENANCE_EXEMPT = [/^\/login$/, /^\/forgot-password$/, /^\/reset-password$/, /^\/api\/auth\//, /^\/api\/health$/, /^\/maintenance$/, /^\/gcs-names\.css$/, /^\/api\/internal\/cli$/, /^\/api\/servers\/bridge\/v1\/[a-z]+$/];

/** Calea rămâne accesibilă tuturor cât timp site-ul e în mentenanță. */
export function isMaintenanceExempt(path: string): boolean {
  return MAINTENANCE_EXEMPT.some((r) => r.test(path));
}
