"use client";

import { faBell as faBellRegular, faCopy as faCopyRegular, faStar as faStarRegular, faFileLines as faFileRegular } from "@fortawesome/free-regular-svg-icons";
import {
  faArrowDown,
  faArrowUp,
  faBell,
  faCheck,
  faChevronDown,
  faChevronUp,
  faClockRotateLeft,
  faCode,
  faColumns,
  faCube,
  faDatabase,
  faEye,
  faEyeSlash,
  faFloppyDisk,
  faFolder,
  faFolderPlus,
  faImage,
  faLayerGroup,
  faListUl,
  faPaperPlane,
  faPenToSquare,
  faPlus,
  faPuzzlePiece,
  faShieldHalved,
  faSitemap,
  faStar,
  faTableCellsLarge,
  faThumbtack,
  faTrash,
  faUpload,
  faXmark,
  type IconDefinition,
} from "@fortawesome/free-solid-svg-icons";
import { GcsIconSvg } from "@gcs/ui";

/**
 * Iconițele componentelor client ale aplicației Pagini, importate individual (registrul întreg nu ajunge în bundle-ul
 * browserului). Un nume necunoscut nu randează nimic.
 */
const ICONS: Record<string, IconDefinition> = {
  "fa-regular fa-bell": faBellRegular,
  "fa-regular fa-copy": faCopyRegular,
  "fa-regular fa-star": faStarRegular,
  "fa-regular fa-file-lines": faFileRegular,
  "fa-solid fa-arrow-down": faArrowDown,
  "fa-solid fa-arrow-up": faArrowUp,
  "fa-solid fa-bell": faBell,
  "fa-solid fa-check": faCheck,
  "fa-solid fa-chevron-down": faChevronDown,
  "fa-solid fa-chevron-up": faChevronUp,
  "fa-solid fa-clock-rotate-left": faClockRotateLeft,
  "fa-solid fa-code": faCode,
  "fa-solid fa-columns": faColumns,
  "fa-solid fa-cube": faCube,
  "fa-solid fa-database": faDatabase,
  "fa-solid fa-eye": faEye,
  "fa-solid fa-eye-slash": faEyeSlash,
  "fa-solid fa-floppy-disk": faFloppyDisk,
  "fa-solid fa-folder": faFolder,
  "fa-solid fa-folder-plus": faFolderPlus,
  "fa-solid fa-image": faImage,
  "fa-solid fa-layer-group": faLayerGroup,
  "fa-solid fa-list-ul": faListUl,
  "fa-solid fa-paper-plane": faPaperPlane,
  "fa-solid fa-pen-to-square": faPenToSquare,
  "fa-solid fa-plus": faPlus,
  "fa-solid fa-puzzle-piece": faPuzzlePiece,
  "fa-solid fa-shield-halved": faShieldHalved,
  "fa-solid fa-sitemap": faSitemap,
  "fa-solid fa-star": faStar,
  "fa-solid fa-table-cells-large": faTableCellsLarge,
  "fa-solid fa-thumbtack": faThumbtack,
  "fa-solid fa-trash": faTrash,
  "fa-solid fa-upload": faUpload,
  "fa-solid fa-xmark": faXmark,
};

export function GcsIcon({ name, className }: { name: string; className?: string }) {
  const icon = ICONS[name];
  return icon ? <GcsIconSvg icon={icon} {...(className ? { className } : {})} /> : null;
}
