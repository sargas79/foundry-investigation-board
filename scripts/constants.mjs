/**
 * Shared constants for the Investigation Board module.
 * @module investigation-board/constants
 */

export const MODULE_ID = "investigation-board";

/** Fully-qualified JournalEntryPage sub-types provided by this module. */
export const PAGE_TYPES = {
  CLUE: `${MODULE_ID}.clue`,
  CONNECTION: `${MODULE_ID}.connection`
};

/** Flag keys written on the case JournalEntry. */
export const CASE_FLAGS = {
  IS_CASE: "isCase",
  STATUS: "status",
  PROGRESS: "progress",
  CLASSIFICATION: "classification",
  ASSIGNED_TO: "assignedTo",
  ARCHIVED: "archived"
};

/** World and client setting keys. */
export const SETTINGS = {
  CLASSIFICATIONS: "classifications"
};

/**
 * Visual templates a clue card can be rendered with. Each maps to a CSS class
 * and dictates which fields the card surfaces.
 * @type {Record<string, {label: string, hasImage: boolean, hasBody: boolean}>}
 */
export const CLUE_TEMPLATES = {
  polaroid: { label: "INVESTIGATION_BOARD.TEMPLATE.Polaroid", hasImage: true, hasBody: false },
  mugshot: { label: "INVESTIGATION_BOARD.TEMPLATE.Mugshot", hasImage: true, hasBody: true },
  profile: { label: "INVESTIGATION_BOARD.TEMPLATE.Profile", hasImage: true, hasBody: true },
  document: { label: "INVESTIGATION_BOARD.TEMPLATE.Document", hasImage: false, hasBody: true },
  letter: { label: "INVESTIGATION_BOARD.TEMPLATE.Letter", hasImage: false, hasBody: true },
  sticky: { label: "INVESTIGATION_BOARD.TEMPLATE.Sticky", hasImage: false, hasBody: true },
  map: { label: "INVESTIGATION_BOARD.TEMPLATE.Map", hasImage: true, hasBody: false }
};

/** How much a clue can be trusted. Drives the badge shown on the card. */
export const RELIABILITY = {
  unverified: "INVESTIGATION_BOARD.RELIABILITY.Unverified",
  questionable: "INVESTIGATION_BOARD.RELIABILITY.Questionable",
  corroborated: "INVESTIGATION_BOARD.RELIABILITY.Corroborated",
  verified: "INVESTIGATION_BOARD.RELIABILITY.Verified",
  debunked: "INVESTIGATION_BOARD.RELIABILITY.Debunked"
};

/** Broad buckets a clue falls into. */
export const CATEGORIES = {
  physical: "INVESTIGATION_BOARD.CATEGORY.Physical",
  testimony: "INVESTIGATION_BOARD.CATEGORY.Testimony",
  document: "INVESTIGATION_BOARD.CATEGORY.Document",
  person: "INVESTIGATION_BOARD.CATEGORY.Person",
  location: "INVESTIGATION_BOARD.CATEGORY.Location",
  lead: "INVESTIGATION_BOARD.CATEGORY.Lead",
  other: "INVESTIGATION_BOARD.CATEGORY.Other"
};

/** Lifecycle of a case, set by whoever owns it. */
export const CASE_STATUSES = {
  active: "INVESTIGATION_BOARD.STATUS.Active",
  hold: "INVESTIGATION_BOARD.STATUS.OnHold",
  cold: "INVESTIGATION_BOARD.STATUS.Cold",
  solved: "INVESTIGATION_BOARD.STATUS.Solved"
};

/** Shipped defaults for the editable case-classification list. */
export const DEFAULT_CLASSIFICATIONS = [
  "Homicide",
  "Missing Person",
  "Theft",
  "Conspiracy",
  "Cold Case"
];

/** Colours offered for pins and strings. */
export const PIN_COLORS = ["red", "blue", "yellow", "green", "white", "black"];

/** Visual styles a connection string can take. */
export const CONNECTION_STYLES = {
  solid: "INVESTIGATION_BOARD.CONNECTION_STYLE.Solid",
  dashed: "INVESTIGATION_BOARD.CONNECTION_STYLE.Dashed",
  dotted: "INVESTIGATION_BOARD.CONNECTION_STYLE.Dotted"
};

/** Default dimensions, in board units, for a newly pinned clue. */
export const CLUE_DEFAULTS = {
  width: 200,
  minWidth: 90,
  maxWidth: 640
};

/** Resolve a path inside this module to a URL Foundry can load. */
export function modulePath(relative) {
  return `modules/${MODULE_ID}/${relative}`;
}
