/**
 * Cookie-urile navigației ACP (o preferință a browserului, nu a contului): ultima zonă afișată în coloana a doua și
 * coloana restrânsă. Sunt citite de layout pe server, ca prima randare să fie deja cea corectă (fără „salt” la hidratare).
 * Constantele stau într-un modul fără „use client”, ca layout-ul (componentă server) să primească valorile lor.
 */
export const ACP_AREA_COOKIE = "gcs-acp-area";
export const ACP_COLUMN_COOKIE = "gcs-acp-column";
/** Un an: preferința rămâne cât timp browserul o păstrează. */
export const ACP_NAV_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
