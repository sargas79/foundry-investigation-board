import {CASE_FLAGS, MODULE_ID, modulePath} from "../constants.mjs";
import {canShareDirectly, currentSharing, shareCase} from "../data/sharing.mjs";
import {findActiveGM} from "../data/case-create.mjs";

const {ApplicationV2, HandlebarsApplicationMixin} = foundry.applications.api;

/**
 * Choosing who can work on a case.
 *
 * Doubles as the GM's hand-out: for a GM every player is simply listed, and ticking one grants it.
 * There is no separate flow because there is no difference in what happens — only in who is doing
 * it and whether the case already belongs to someone.
 */
export default class ShareDialog extends HandlebarsApplicationMixin(ApplicationV2) {

  /** @override */
  static DEFAULT_OPTIONS = {
    id: "investigation-board-share",
    classes: [MODULE_ID, "ib-dialog"],
    tag: "form",
    window: {
      title: "INVESTIGATION_BOARD.DIALOG.Share",
      icon: "fa-solid fa-user-group",
      contentClasses: ["standard-form"]
    },
    position: {width: 420, height: "auto"},
    form: {handler: ShareDialog.#onSubmit, closeOnSubmit: true}
  };

  /** @override */
  static PARTS = {
    body: {template: modulePath("templates/dialog/share.hbs"), classes: ["standard-form"]},
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
    return game.i18n.format("INVESTIGATION_BOARD.DIALOG.ShareFor", {name: this.journal.name});
  }

  /* -------------------------------------------- */

  /** @inheritDoc */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const sharing = currentSharing(this.journal);
    const assigned = this.journal.getFlag(MODULE_ID, CASE_FLAGS.ASSIGNED_TO);
    const needsGM = !canShareDirectly();

    return Object.assign(context, {
      wholeParty: sharing.wholeParty,
      // The case's own player is listed but not unticked: sharing must never orphan a case.
      players: game.users
        .filter(u => !u.isGM)
        .map(u => ({
          id: u.id,
          name: u.name,
          color: u.color?.css ?? u.color,
          shared: sharing.userIds.has(u.id),
          locked: u.id === assigned
        })),
      needsGM,
      gmOnline: !!findActiveGM(),
      buttons: [{type: "submit", icon: "fa-solid fa-check", label: "INVESTIGATION_BOARD.Save"}]
    });
  }

  /* -------------------------------------------- */

  /**
   * Apply the chosen sharing.
   * @this {ShareDialog}
   * @param {SubmitEvent} _event
   * @param {HTMLFormElement} form
   * @returns {Promise<void>}
   */
  static async #onSubmit(_event, form) {
    const wholeParty = form.elements.wholeParty?.checked ?? false;
    const userIds = [...form.querySelectorAll('input[name="player"]:checked')]
      .map(input => input.value);
    await shareCase(this.journal, {userIds, wholeParty});
  }

  /* -------------------------------------------- */

  /**
   * Open the sharing dialog for a case.
   * @param {JournalEntry} journal
   * @returns {Promise<ShareDialog>}
   */
  static open(journal) {
    return new this({journal}).render({force: true});
  }
}
