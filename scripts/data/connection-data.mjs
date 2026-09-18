import {CONNECTION_STYLES, PIN_COLORS} from "../constants.mjs";

const fields = foundry.data.fields;

/**
 * The data model backing a single string tying two clues together.
 *
 * Connections are their own documents rather than entries in a flag on the clue: linking is then a
 * page create and unlinking a page delete, with no nested-object surgery and no two players racing
 * to write the same flag.
 *
 * `from` and `to` hold the *page ids* of the clues, which are unique within the case.
 */
export default class ConnectionData extends foundry.abstract.TypeDataModel {

  /** @override */
  static defineSchema() {
    return {
      from: new fields.DocumentIdField({required: true, nullable: false}),
      to: new fields.DocumentIdField({required: true, nullable: false}),
      color: new fields.StringField({
        required: true,
        blank: false,
        initial: "red",
        choices: PIN_COLORS
      }),
      label: new fields.StringField({required: false, blank: true, initial: ""}),
      style: new fields.StringField({
        required: true,
        blank: false,
        initial: "solid",
        choices: Object.keys(CONNECTION_STYLES)
      })
    };
  }

  /* -------------------------------------------- */

  /**
   * Whether this connection joins the given clue page id.
   * @param {string} clueId
   * @returns {boolean}
   */
  touches(clueId) {
    return (this.from === clueId) || (this.to === clueId);
  }

  /* -------------------------------------------- */

  /**
   * The id of the clue at the other end of this string.
   * @param {string} clueId   One end of the connection.
   * @returns {string|null}   The opposite end, or null if `clueId` is not part of this connection.
   */
  other(clueId) {
    if ( this.from === clueId ) return this.to;
    if ( this.to === clueId ) return this.from;
    return null;
  }
}
