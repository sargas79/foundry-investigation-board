import {MODULE_ID, PAGE_TYPES, modulePath} from "../constants.mjs";
import {canEditReport, getFindings} from "../data/case.mjs";
import {authorStamp} from "../data/authorship.mjs";

const {ApplicationV2, HandlebarsApplicationMixin} = foundry.applications.api;

/**
 * Writing a page of the case file — the opening document or a findings page.
 *
 * One form for both, as with the clue dialog: the fields are nearly identical and keeping them
 * together stops the two drifting apart. Only the brief asks for a case number.
 */
export default class ReportDialog extends HandlebarsApplicationMixin(ApplicationV2) {

  /** @override */
  static DEFAULT_OPTIONS = {
    id: "investigation-board-report-dialog",
    classes: [MODULE_ID, "ib-dialog"],
    tag: "form",
    window: {
      title: "INVESTIGATION_BOARD.DIALOG.Report",
      icon: "fa-solid fa-file-pen",
      contentClasses: ["standard-form"]
    },
    position: {width: 620, height: "auto"},
    form: {handler: ReportDialog.#onSubmit, closeOnSubmit: true}
  };

  /** @override */
  static PARTS = {
    body: {template: modulePath("templates/dialog/report.hbs"), classes: ["standard-form"]},
    footer: {template: modulePath("templates/dialog/dialog-footer.hbs")}
  };

  /**
   * @param {object} options
   * @param {JournalEntry} options.journal
   * @param {JournalEntryPage} [options.page]   An existing page to rewrite.
   * @param {string} [options.kind]             "brief" or "entry", for a new page.
   */
  constructor({journal, page, kind = "entry", ...options} = {}) {
    super(options);
    this.journal = journal;
    this.page = page ?? null;
    this.kind = page?.system.kind ?? kind;
  }

  /** Whether an existing page is being rewritten. */
  get isEdit() {
    return !!this.page;
  }

  /** @override */
  get title() {
    const key = this.kind === "brief"
      ? "INVESTIGATION_BOARD.DIALOG.OpeningFile"
      : "INVESTIGATION_BOARD.DIALOG.Finding";
    return game.i18n.localize(key);
  }

  /* -------------------------------------------- */

  /** @inheritDoc */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const system = this.page?.system;
    return Object.assign(context, {
      isBrief: this.kind === "brief",
      caseName: this.journal.name,
      name: this.page?.name ?? "",
      caseNumber: system?.caseNumber ?? "",
      body: system?.body ?? "",
      // Redacted passages are not in the body any more, so editing cannot disturb them — but the
      // writer should know they are there.
      redactions: system?.sealed?.length ?? 0,
      buttons: [{
        type: "submit",
        icon: "fa-solid fa-check",
        label: this.isEdit ? "INVESTIGATION_BOARD.Save" : "INVESTIGATION_BOARD.Write"
      }]
    });
  }

  /* -------------------------------------------- */

  /**
   * Save the page.
   * @this {ReportDialog}
   * @param {SubmitEvent} _event
   * @param {HTMLFormElement} _form
   * @param {FormDataExtended} formData
   * @returns {Promise<void>}
   */
  static async #onSubmit(_event, _form, formData) {
    const data = foundry.utils.expandObject(formData.object);
    const isBrief = this.kind === "brief";
    const fallback = isBrief
      ? game.i18n.format("INVESTIGATION_BOARD.OpeningFileFor", {name: this.journal.name})
      : game.i18n.localize("INVESTIGATION_BOARD.UntitledFinding");
    const name = data.name?.trim() || fallback;

    if ( this.isEdit ) {
      if ( !canEditReport(this.page, game.user) ) {
        ui.notifications.warn("INVESTIGATION_BOARD.NOTIFY.NotYourFinding", {localize: true});
        return;
      }
      await this.page.update({
        name,
        system: {
          body: data.body ?? "",
          ...(isBrief ? {caseNumber: data.caseNumber?.trim() ?? ""} : {})
        }
      });
      return;
    }

    // There is no page yet, so the case itself is the authority — the same test the buttons that
    // opened this dialog are drawn from. Checked here as well as there so the create and the edit
    // rules cannot quietly drift apart again.
    if ( !game.user.isGM && !this.journal?.isOwner ) {
      ui.notifications.warn("INVESTIGATION_BOARD.NOTIFY.NoPermission", {localize: true});
      return;
    }

    // New findings go to the end of the file, so it reads in the order it was written.
    const sort = getFindings(this.journal).length;
    await this.journal.createEmbeddedDocuments("JournalEntryPage", [{
      name,
      type: PAGE_TYPES.REPORT,
      system: {
        kind: this.kind,
        caseNumber: isBrief ? (data.caseNumber?.trim() ?? "") : "",
        body: data.body ?? "",
        author: game.user.id,
        // The character's name, so the file reads as the party wrote it.
        authorName: authorStamp().createdByName,
        createdAt: Date.now(),
        sealed: [],
        sort: isBrief ? -1 : sort
      }
    }]);
  }

  /* -------------------------------------------- */

  /** Open the opening file for writing. */
  static createBrief(journal) {
    return new this({journal, kind: "brief"}).render({force: true});
  }

  /** Open a blank findings page. */
  static createFinding(journal) {
    return new this({journal, kind: "entry"}).render({force: true});
  }

  /** Rewrite an existing page. */
  static edit(page) {
    return new this({journal: page.parent, page}).render({force: true});
  }
}
