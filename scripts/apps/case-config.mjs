import {CASE_FLAGS, CASE_STATUSES, MODULE_ID, modulePath} from "../constants.mjs";
import {caseState} from "../data/case.mjs";
import {getClassifications} from "../settings.mjs";

const {ApplicationV2, HandlebarsApplicationMixin} = foundry.applications.api;

/**
 * The case file's own details: its name, what kind of case it is, and where it stands.
 *
 * Status and progress are the investigators' own judgement, not something computed from the board
 * — a case can feel 80% solved on one verified clue, or 10% on twenty. So this is open to any
 * owner, player or GM alike.
 */
export default class CaseConfig extends HandlebarsApplicationMixin(ApplicationV2) {

  /** @override */
  static DEFAULT_OPTIONS = {
    id: "investigation-board-case-config",
    classes: [MODULE_ID, "ib-dialog"],
    tag: "form",
    window: {
      title: "INVESTIGATION_BOARD.DIALOG.CaseDetails",
      icon: "fa-solid fa-folder-open",
      contentClasses: ["standard-form"]
    },
    position: {width: 460, height: "auto"},
    form: {
      handler: CaseConfig.#onSubmit,
      closeOnSubmit: true
    }
  };

  /** @override */
  static PARTS = {
    body: {template: modulePath("templates/dialog/case-config.hbs"), classes: ["standard-form"]},
    footer: {template: modulePath("templates/dialog/dialog-footer.hbs")}
  };

  /* -------------------------------------------- */

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
    return game.i18n.format("INVESTIGATION_BOARD.DIALOG.CaseDetailsFor", {name: this.journal.name});
  }

  /* -------------------------------------------- */

  /** @inheritDoc */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const state = caseState(this.journal);
    const known = getClassifications();

    return Object.assign(context, {
      name: this.journal.name,
      state,
      statuses: Object.entries(CASE_STATUSES).map(([value, label]) => ({
        value,
        label: game.i18n.localize(label)
      })),
      // The list is a suggestion, not a constraint: a table can name a case whatever it likes.
      classifications: known,
      buttons: [{type: "submit", icon: "fa-solid fa-check", label: "INVESTIGATION_BOARD.Save"}]
    });
  }

  /* -------------------------------------------- */

  /**
   * Save the case's details.
   * @this {CaseConfig}
   * @param {SubmitEvent} _event
   * @param {HTMLFormElement} _form
   * @param {FormDataExtended} formData
   * @returns {Promise<void>}
   */
  static async #onSubmit(_event, _form, formData) {
    const data = foundry.utils.expandObject(formData.object);
    const name = data.name?.trim();

    await this.journal.update({
      ...(name ? {name} : {}),
      flags: {
        [MODULE_ID]: {
          [CASE_FLAGS.STATUS]: data.status,
          [CASE_FLAGS.PROGRESS]: Math.clamp(Math.round(Number(data.progress) || 0), 0, 100),
          [CASE_FLAGS.CLASSIFICATION]: data.classification?.trim() ?? ""
        }
      }
    });
  }

  /* -------------------------------------------- */

  /**
   * Open the details for a case.
   * @param {JournalEntry} journal
   * @returns {Promise<CaseConfig>}
   */
  static open(journal) {
    return new this({journal}).render({force: true});
  }
}
