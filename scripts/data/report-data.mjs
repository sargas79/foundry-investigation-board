import {REPORT_KINDS} from "../constants.mjs";

const fields = foundry.data.fields;

/**
 * A page of the case file — either the opening document or a findings page added later.
 *
 * Both are the same sub-type because they are the same thing to a reader: a dated, attributed
 * piece of writing about the case. Only `kind` differs, and with it a handful of fields the brief
 * uses and an entry does not.
 *
 * Redacted passages are **not** stored here. They are moved into a separate GM-only document and
 * only a marker is left behind, because nothing about a field or a page keeps its contents off a
 * player's client — see `sealed` below.
 */
export default class ReportData extends foundry.abstract.TypeDataModel {

  /** @override */
  static defineSchema() {
    return {
      kind: new fields.StringField({
        required: true,
        blank: false,
        initial: "entry",
        choices: Object.keys(REPORT_KINDS)
      }),

      /** The case's own reference, e.g. "4471-B". Typed by whoever opens the file. */
      caseNumber: new fields.StringField({required: false, blank: true, initial: ""}),

      body: new fields.HTMLField({required: false, initial: ""}),

      author: new fields.StringField({required: false, nullable: true, initial: null}),
      /** The character's name as it was when this was written. See data/authorship.mjs. */
      authorName: new fields.StringField({required: false, blank: true, initial: ""}),
      createdAt: new fields.NumberField({required: false, nullable: true, initial: null, integer: true}),

      /**
       * Where text has been cut out.
       *
       * Each marker records only that *something* was removed and by whom — never the text. The
       * text itself lives in the GM-only companion entry, keyed by this id. A player's client
       * holds this array and learns nothing from it.
       */
      sealed: new fields.ArrayField(new fields.SchemaField({
        id: new fields.StringField({required: true, blank: false}),
        label: new fields.StringField({required: false, blank: true, initial: ""}),
        sealedBy: new fields.StringField({required: false, nullable: true, initial: null}),
        sealedAt: new fields.NumberField({required: false, nullable: true, initial: null, integer: true})
      })),

      /** Ordering for findings pages, so they read in the order they were written. */
      sort: new fields.NumberField({required: true, nullable: false, integer: true, initial: 0})
    };
  }

  /* -------------------------------------------- */

  /** Whether this is the case's opening document. */
  get isBrief() {
    return this.kind === "brief";
  }

  /* -------------------------------------------- */

  /** Whether anything in this page has been redacted. */
  get hasRedactions() {
    return this.sealed.length > 0;
  }

  /* -------------------------------------------- */

  /**
   * The marker for a sealed passage, if it is one of this page's.
   * @param {string} id
   * @returns {{id: string, label: string}|undefined}
   */
  sealedMarker(id) {
    return this.sealed.find(s => s.id === id);
  }
}
