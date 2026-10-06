import {
  faChartLine,
  faComments,
  faCrown,
  faFileLines,
  faGamepad,
  faGears,
  faPalette,
  faRightLeft,
  faUsers,
} from "@fortawesome/free-solid-svg-icons";
import type { GcsAcpIconDef } from "./types";

/** Iconițele Font Awesome ale grupurilor din sidebar-ul ACP (importate individual: componentele client le folosesc direct). */
export const ACP_APP_ICONS: Record<string, GcsAcpIconDef> = {
  system: faGears,
  community: faComments,
  members: faUsers,
  vip: faCrown,
  gaming: faGamepad,
  pages: faFileLines,
  stats: faChartLine,
  appearance: faPalette,
  conversions: faRightLeft,
};
