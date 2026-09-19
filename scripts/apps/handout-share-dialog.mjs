import {MODULE_ID, modulePath} from "../constants.mjs";
import {currentHolders, shareHandout} from "../data/handouts.mjs";

const {ApplicationV2, HandlebarsApplicationMixin} = foundry.applications.api;

/**
 * Handing a document to players.
 *
 * Deliberately separate from the case share dialog rather than a mode of it. The two answer
 * different questions — "who is working this case" against "who has been given this piece of
 * paper" — and they grant different things: a case is shared as Owner so the party can work on it,
 * a handout as Observer so the document stays the GM's. Folding them together would mean one form
 * whose meaning changed under the reader.
 *
 * Unticking everyone is how a document is taken back; there is no separate revoke.
 */
export default class HandoutShareDialog extends HandlebarsApplicationMixin(ApplicationV2) {

  /** @override */
  static DEFAULT_OPTIONS = {
    id: "investigation-board-handout-share",
    classes: [MODULE_ID, "ib-dialog"],
    tag: "form",
    window: {
      title: "INVESTIGATION_BOARD.DIALOG.HandOver",
      icon: "fa-solid fa-hand-holding",
      contentClasses: ["standard-form"]
    },
    position: {width: 420, height: "auto"},
    form: {handler: HandoutShareDialog.#onSubmit, closeOnSubmit: true}
  };

  /** @override */
  static PARTS = {
    body: {template: modulePath("templates/dialog/handout-share.hbs"), classes: ["standard-form"]},
    footer: {template: modulePath("templates/dialog/dialog-footer.hbs")}
  };

  /**
   * @param {object} options
   * @param {JournalEntry} options.journal
   */
  constructor({journal, ...options} = {}) {
    super(options);
    this.journal = journal;
  }

  /** @override */
  get title() {
    return game.i18n.format("INVESTIGATION_BOARD.DIALOG.HandOverFor", {name: this.journal.name});
  }

  /* -------------------------------------------- */

  /** @inheritDoc */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const holders = currentHolders(this.journal);

    return Object.assign(context, {
      wholeParty: holders.wholeParty,
      players: game.users
        .filter(u => !u.isGM)
        .map(u => ({
          id: u.id,
          name: u.name,
          color: u.color?.css ?? u.color,
          // A player who is not logged in can still be handed a document; it is waiting for them.
          offline: !u.active,
          shared: holders.userIds.has(u.id)
        })),
      buttons: [{type: "submit", icon: "fa-solid fa-check", label: "INVESTIGATION_BOARD.Save"}]
    });
  }

  /* -------------------------------------------- */

  /**
   * Apply the chosen hand-over.
   * @this {HandoutShareDialog}
   * @param {SubmitEvent} _event
   * @param {HTMLFormElement} form
   * @returns {Promise<void>}
   */
  static async #onSubmit(_event, form) {
    const wholeParty = form.elements.wholeParty?.checked ?? false;
    const userIds = [...form.querySelectorAll('input[name="player"]:checked')]
      .map(input => input.value);
    await shareHandout(this.journal, {userIds, wholeParty});
  }

  /* -------------------------------------------- */

  /**
   * Open the hand-over dialog for a document.
   * @param {JournalEntry} journal
   * @returns {Promise<HandoutShareDialog>}
   */
  static open(journal) {
    return new this({journal}).render({force: true});
  }
}
