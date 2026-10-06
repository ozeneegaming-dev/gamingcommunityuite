import {
  faChartLine,
  faComments,
  faCrown,
  faFileLines,
  faGamepad,
  faGears,
  faPalette,
  faUsers,
} from "@fortawesome/free-solid-svg-icons";
import type { GcsAcpIconDef } from "./types";

/** Iconițele Font Awesome ale aplicațiilor din bara ACP (importate individual: componentele client le folosesc direct). */
export const ACP_APP_ICONS: Record<string, GcsAcpIconDef> = {
  system: faGears,
  community: faComments,
  members: faUsers,
  vip: faCrown,
  gaming: faGamepad,
  pages: faFileLines,
  stats: faChartLine,
  appearance: faPalette,
};
