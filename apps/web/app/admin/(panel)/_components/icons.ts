import {
  faChartLine,
  faComments,
  faCrown,
  faGamepad,
  faGaugeHigh,
  faGears,
  faPalette,
  faPuzzlePiece,
  faUsers,
} from "@fortawesome/free-solid-svg-icons";
import type { GcsAcpIconDef } from "./types";

/** Iconițele Font Awesome ale zonelor din bara ACP (importate individual: componentele client le folosesc direct). */
export const ACP_AREA_ICONS: Record<string, GcsAcpIconDef> = {
  dashboard: faGaugeHigh,
  system: faGears,
  community: faComments,
  members: faUsers,
  appearance: faPalette,
  gaming: faGamepad,
  vip: faCrown,
  stats: faChartLine,
  apps: faPuzzlePiece,
};
