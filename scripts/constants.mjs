/**
 * Shared constants for the Investigation Board module.
 * @module investigation-board/constants
 */

export const MODULE_ID = "investigation-board";

/** Fully-qualified JournalEntryPage sub-types provided by this module. */
export const PAGE_TYPES = {
  CLUE: `${MODULE_ID}.clue`,
  CONNECTION: `${MODULE_ID}.connection`,
  REPORT: `${MODULE_ID}.report`,
  HANDOUT: `${MODULE_ID}.handout`
};

/**
 * The two kinds of case-file page. One document each way — to a reader they are the same thing,
 * a dated and attributed piece of writing about the case.
 */
export const REPORT_KINDS = {
  brief: "INVESTIGATION_BOARD.REPORT.Brief",
  entry: "INVESTIGATION_BOARD.REPORT.Entry"
};

/** Flag keys written on the case JournalEntry. */
export const CASE_FLAGS = {
  IS_CASE: "isCase",
  /** The GM-only companion entry holding this case's redacted passages. */
  SEALED_ENTRY: "sealedEntry",
  /** On the companion entry itself: which case it belongs to. */
  SEALED_FOR: "sealedFor",
  STATUS: "status",
  PROGRESS: "progress",
  CLASSIFICATION: "classification",
  ASSIGNED_TO: "assignedTo",
  ARCHIVED: "archived"
};

/** Flag keys written on a handout's own JournalEntry. */
export const HANDOUT_FLAGS = {
  /** Marks the entry as a handout rather than an ordinary journal or a case. */
  IS_HANDOUT: "isHandout"
};

/**
 * The kinds of document a GM can hand over.
 *
 * A kind is a *look* plus a starting set of blanks, not a schema of its own: every handout stores
 * the same fields (see data/handout-data.mjs), and the kind decides how they are laid out and
 * which ones are worth offering first. That way a badge can grow a "Notes" line and a death record
 * can lose one without either becoming a special case in the code.
 *
 * `portrait` marks the kinds whose image is a photograph *of a person*, shown small beside the
 * detail rows; the rest show their image as a full-width scan of the document.
 *
 * @type {Record<string, {label: string, icon: string, portrait: boolean, fields: string[]}>}
 */
export const HANDOUT_KINDS = {
  death: {
    label: "INVESTIGATION_BOARD.HANDOUT_KIND.Death",
    icon: "fa-solid fa-cross",
    portrait: false,
    fields: [
      "INVESTIGATION_BOARD.HANDOUT_FIELD.Deceased",
      "INVESTIGATION_BOARD.HANDOUT_FIELD.DateOfDeath",
      "INVESTIGATION_BOARD.HANDOUT_FIELD.PlaceOfDeath",
      "INVESTIGATION_BOARD.HANDOUT_FIELD.CauseOfDeath",
      "INVESTIGATION_BOARD.HANDOUT_FIELD.CertifiedBy"
    ]
  },
  badge: {
    label: "INVESTIGATION_BOARD.HANDOUT_KIND.Badge",
    icon: "fa-solid fa-id-badge",
    portrait: true,
    fields: [
      "INVESTIGATION_BOARD.HANDOUT_FIELD.Name",
      "INVESTIGATION_BOARD.HANDOUT_FIELD.Position",
      "INVESTIGATION_BOARD.HANDOUT_FIELD.EmployeeNo",
      "INVESTIGATION_BOARD.HANDOUT_FIELD.Clearance"
    ]
  },
  article: {
    label: "INVESTIGATION_BOARD.HANDOUT_KIND.Article",
    icon: "fa-solid fa-newspaper",
    portrait: false,
    fields: [
      "INVESTIGATION_BOARD.HANDOUT_FIELD.Byline",
      "INVESTIGATION_BOARD.HANDOUT_FIELD.Page"
    ]
  },
  police: {
    label: "INVESTIGATION_BOARD.HANDOUT_KIND.Police",
    icon: "fa-solid fa-fingerprint",
    portrait: true,
    fields: [
      "INVESTIGATION_BOARD.HANDOUT_FIELD.Subject",
      "INVESTIGATION_BOARD.HANDOUT_FIELD.Offence",
      "INVESTIGATION_BOARD.HANDOUT_FIELD.Arrested",
      "INVESTIGATION_BOARD.HANDOUT_FIELD.Officer",
      "INVESTIGATION_BOARD.HANDOUT_FIELD.Disposition"
    ]
  },
  identity: {
    label: "INVESTIGATION_BOARD.HANDOUT_KIND.Identity",
    icon: "fa-solid fa-id-card",
    portrait: true,
    fields: [
      "INVESTIGATION_BOARD.HANDOUT_FIELD.Name",
      "INVESTIGATION_BOARD.HANDOUT_FIELD.DateOfBirth",
      "INVESTIGATION_BOARD.HANDOUT_FIELD.Number",
      "INVESTIGATION_BOARD.HANDOUT_FIELD.Expires"
    ]
  },
  document: {
    label: "INVESTIGATION_BOARD.HANDOUT_KIND.Document",
    icon: "fa-solid fa-file-lines",
    portrait: false,
    fields: []
  }
};

/** How a handout maps onto a clue card when a player pins it to a board. */
export const HANDOUT_CLUE_TEMPLATES = {
  death: {template: "document", category: "document"},
  badge: {template: "profile", category: "person"},
  article: {template: "document", category: "document"},
  police: {template: "mugshot", category: "person"},
  identity: {template: "profile", category: "person"},
  document: {template: "document", category: "document"}
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
