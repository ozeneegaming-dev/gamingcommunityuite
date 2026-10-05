/**
 * Cine face o acțiune (spec §6.3). Un vizitator are `userId: null` și `groupIds: [guestId]`.
 * `groupIds` conține grupul principal și grupurile secundare.
 */
export type GcsActor = {
  userId: string | null;
  groupIds: number[];
  primaryGroupId: number;
  isBanned: boolean;
  ip: string;
};

/** Un container cu permisiuni proprii (forum, categorie Downloads, album…). */
export type GcsContainerRef = { type: string; id: string };
