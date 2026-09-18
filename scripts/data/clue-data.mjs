import {
  CATEGORIES,
  CLUE_DEFAULTS,
  CLUE_TEMPLATES,
  PIN_COLORS,
  RELIABILITY
} from "../constants.mjs";

const fields = foundry.data.fields;

/**
 * The data model backing a single clue pinned to an investigation board.
 *
 * One clue is one JournalEntryPage of sub-type `investigation-board.clue`, which keeps concurrent
 * edits from different players isolated to separate documents and lets a clue carry its own
 * ownership (so the GM can stage a clue before revealing it).
 *
 * The clue's display name is the page's `name`; everything else lives here.
 */
export default class ClueData extends foundry.abstract.TypeDataModel {

  /** @override */
  static defineSchema() {
    return {
      // --- Appearance -------------------------------------------------------
      template: new fields.StringField({
        required: true,
        blank: false,
        initial: "polaroid",
        choices: Object.keys(CLUE_TEMPLATES)
      }),
      image: new fields.FilePathField({categories: ["IMAGE"], base64: false}),
      body: new fields.HTMLField({required: false, initial: ""}),
      pinColor: new fields.StringField({
        required: true,
        blank: false,
        initial: "red",
        choices: PIN_COLORS
      }),
      redacted: new fields.BooleanField({initial: false}),

      // --- Classification ---------------------------------------------------
      category: new fields.StringField({
        required: true,
        blank: false,
        initial: "other",
        choices: Object.keys(CATEGORIES)
      }),
      reliability: new fields.StringField({
        required: true,
        blank: false,
        initial: "unverified",
        choices: Object.keys(RELIABILITY)
      }),

      // --- Placement on the board -------------------------------------------
      x: new fields.NumberField({required: true, integer: true, nullable: false, initial: 0}),
      y: new fields.NumberField({required: true, integer: true, nullable: false, initial: 0}),
      rotation: new fields.NumberField({required: true, nullable: false, initial: 0, min: -30, max: 30}),
      width: new fields.NumberField({
        required: true,
        integer: true,
        nullable: false,
        initial: CLUE_DEFAULTS.width,
        min: CLUE_DEFAULTS.minWidth,
        max: CLUE_DEFAULTS.maxWidth
      }),
      z: new fields.NumberField({required: true, integer: true, nullable: false, initial: 0}),

      // --- Who pinned it ----------------------------------------------------
      // Recorded as both a reference and a snapshot: the uuid follows a rename, the name survives
      // the actor being reassigned or deleted. See scripts/data/authorship.mjs.
      createdBy: new fields.StringField({required: false, nullable: true, initial: null}),
      createdByActor: new fields.DocumentUUIDField({required: false, nullable: true, initial: null}),
      createdByName: new fields.StringField({required: false, blank: true, initial: ""}),
      createdAt: new fields.NumberField({required: false, nullable: true, initial: null, integer: true}),

      // --- Links and annotations --------------------------------------------
      linkedUuid: new fields.DocumentUUIDField({required: false, nullable: true, initial: null}),
      notes: new fields.ArrayField(new fields.SchemaField({
        author: new fields.StringField({required: true, blank: false}),
        text: new fields.StringField({required: true, blank: true, initial: ""}),
        time: new fields.NumberField({required: true, integer: true, nullable: false, initial: 0})
      })),

      // --- Dismissal (players archive clues; only the GM truly deletes) ------
      dismissed: new fields.BooleanField({initial: false}),
      dismissedBy: new fields.StringField({required: false, nullable: true, initial: null}),
      dismissedAt: new fields.NumberField({required: false, nullable: true, initial: null, integer: true})
    };
  }

  /* -------------------------------------------- */

  /** Configuration of the template this clue renders with. */
  get templateConfig() {
    return CLUE_TEMPLATES[this.template] ?? CLUE_TEMPLATES.polaroid;
  }

  /* -------------------------------------------- */

  /**
   * Whether this clue should currently appear on the board surface. Dismissed clues live in the
   * discarded tray until somebody recovers them.
   * @type {boolean}
   */
  get onBoard() {
    return !this.dismissed;
  }
}
