import {HANDOUT_KINDS} from "../constants.mjs";

const fields = foundry.data.fields;

/**
 * A document the GM hands over: a death record, a company badge, a newspaper clipping, an ID.
 *
 * One handout is one JournalEntryPage of sub-type `investigation-board.handout`, and it is the only
 * page of its own JournalEntry. That envelope is not ceremony — it is the whole security model.
 * Ownership is enforced by the server on *top-level* documents only, so a handout that is to be
 * genuinely unreadable until the GM shares it has to be a document of its own. Page-level ownership
 * would filter the display and still ship the text to every player's client, which is the same trap
 * `data/redaction.mjs` exists to avoid.
 *
 * Every kind shares this one schema. A kind chooses the layout and seeds a starting set of blanks;
 * it does not get fields of its own, because the moment it did, a GM adding "Next of Kin" to a
 * death record would need a code change. The variable part of a document is `rows` — labelled
 * lines, in the order they should be read.
 */
export default class HandoutData extends foundry.abstract.TypeDataModel {

  /** @override */
  static defineSchema() {
    return {
      kind: new fields.StringField({
        required: true,
        blank: false,
        initial: "document",
        choices: Object.keys(HANDOUT_KINDS)
      }),

      /**
       * The authority the document issued from — a police force, an employer, a masthead.
       * Printed across the head of the document, which is what makes it read as official.
       */
      issuer: new fields.StringField({required: false, blank: true, initial: ""}),

      /** The document's own reference: a file number, a certificate number, a badge number. */
      reference: new fields.StringField({required: false, blank: true, initial: ""}),

      /**
       * When the document is dated, as free text.
       *
       * Deliberately not a date field: an in-fiction date is "14th Brume, 1204" or "spring, some
       * years ago" as often as it is a calendar date, and a picker would refuse all of those.
       */
      dateline: new fields.StringField({required: false, blank: true, initial: ""}),

      /** A photograph or a scan of the document itself; which of the two is decided by the kind. */
      image: new fields.FilePathField({categories: ["IMAGE"], base64: false}),

      /** The prose: an article's text, an officer's narrative, the body of a letter. */
      body: new fields.HTMLField({required: false, initial: ""}),

      /**
       * The labelled lines that make up the document's particulars.
       *
       * Free-form on purpose — see the class note. Order is the array's order, so a GM rearranging
       * them rearranges what the player reads.
       */
      rows: new fields.ArrayField(new fields.SchemaField({
        label: new fields.StringField({required: true, blank: true, initial: ""}),
        value: new fields.StringField({required: true, blank: true, initial: ""})
      })),

      // --- Who wrote it -------------------------------------------------------
      // Same stamp a clue carries, so a handout can be traced back the same way. In practice this
      // is always a GM, but recording it costs nothing and an Assistant GM is a real possibility.
      createdBy: new fields.StringField({required: false, nullable: true, initial: null}),
      createdByActor: new fields.DocumentUUIDField({required: false, nullable: true, initial: null}),
      createdByName: new fields.StringField({required: false, blank: true, initial: ""}),
      createdAt: new fields.NumberField({required: false, nullable: true, initial: null, integer: true})
    };
  }

  /* -------------------------------------------- */

  /** Configuration of the kind this handout is presented as. */
  get kindConfig() {
    return HANDOUT_KINDS[this.kind] ?? HANDOUT_KINDS.document;
  }

  /* -------------------------------------------- */

  /**
   * The rows worth showing: a line with neither a label nor a value is a blank the GM left behind
   * when seeding the kind, and printing it would put an empty rule across the document.
   * @type {{label: string, value: string}[]}
   */
  get filledRows() {
    return this.rows.filter(row => row.label.trim() || row.value.trim());
  }
}
