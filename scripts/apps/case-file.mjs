import {MODULE_ID, PAGE_TYPES, modulePath} from "../constants.mjs";
import {characterName} from "../data/authorship.mjs";
import {canEditReport, getBrief, getFindings} from "../data/case.mjs";
import {peekSealed, redactPassage, revealPassage} from "../data/redaction.mjs";

const {ApplicationV2, HandlebarsApplicationMixin} = foundry.applications.api;

/**
 * The case file: the official record of a case, beside the board.
 *
 * The board is where the party works a case out; this is what they write down. It opens as its own
 * window rather than a panel on the board, because the two get used at different moments — the
 * board during play, the file when someone stops to record what they found.
 */
export default class CaseFile extends HandlebarsApplicationMixin(ApplicationV2) {

  /** @override */
  static DEFAULT_OPTIONS = {
    id: "investigation-board-case-file",
    classes: [MODULE_ID, "ib-case-file"],
    tag: "div",
    window: {
      title: "INVESTIGATION_BOARD.CaseFile",
      icon: "fa-solid fa-folder-open",
      resizable: true,
      contentClasses: ["ib-case-file-content"]
    },
    position: {width: 720, height: 780},
    actions: {
      editBrief: CaseFile.#onEditBrief,
      addFinding: CaseFile.#onAddFinding,
      editFinding: CaseFile.#onEditFinding,
      deleteFinding: CaseFile.#onDeleteFinding,
      revealRedaction: CaseFile.#onRevealRedaction,
      redactSelection: CaseFile.#onRedactSelection
    }
  };

  /** @override */
  static PARTS = {
    file: {template: modulePath("templates/case-file.hbs"), scrollable: [".ib-file-body"]}
  };

  /**
   * @param {object} options
   * @param {string} options.caseId
   */
  constructor({caseId, ...options} = {}) {
    super(options);
    this.caseId = caseId;
  }

  /** The case this file belongs to. */
  get currentCase() {
    return game.journal.get(this.caseId) ?? null;
  }

  /** @override */
  get title() {
    const name = this.currentCase?.name ?? "";
    return game.i18n.format("INVESTIGATION_BOARD.CaseFileFor", {name});
  }

  /* -------------------------------------------- */

  /** @inheritDoc */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const journal = this.currentCase;
    if ( !journal ) return Object.assign(context, {missing: true});

    const editor = foundry.applications.ux.TextEditor.implementation;
    const enrich = async page => {
      const html = await editor.enrichHTML(page.system.body ?? "", {
        relativeTo: page, secrets: page.isOwner
      });
      // A GM reading the file sees what is behind each black bar, inline and marked as sealed.
      return game.user.isGM ? this.#showSealedToGM(html, journal) : html;
    };

    const brief = getBrief(journal);
    const findings = getFindings(journal);

    return Object.assign(context, {
      isGM: game.user.isGM,
      caseName: journal.name,
      brief: brief ? {
        id: brief.id,
        caseNumber: brief.system.caseNumber,
        body: await enrich(brief),
        editable: canEditReport(brief, game.user),
        redactions: brief.system.sealed.length
      } : null,
      canStartBrief: !brief && journal.isOwner,
      findings: await Promise.all(findings.map(async page => ({
        id: page.id,
        name: page.name,
        body: await enrich(page),
        byline: this.#byline(page),
        editable: canEditReport(page, game.user),
        deletable: game.user.isGM || (page.system.author === game.user.id)
      }))),
      canAddFinding: journal.isOwner
    });
  }

  /* -------------------------------------------- */

  /**
   * Put the sealed text back into the markup, for the GM's eyes only.
   *
   * Safe because it reads from the companion entry, which is a document a player's client simply
   * does not have — there is nothing here for a player to intercept.
   *
   * @param {string} html
   * @param {JournalEntry} journal
   * @returns {string}
   */
  #showSealedToGM(html, journal) {
    return html.replace(
      /<span class="ib-redacted"[^>]*data-redaction-id="([^"]+)"[^>]*>.*?<\/span>/g,
      (match, id) => {
        const text = peekSealed(journal, id);
        if ( text === null ) return match;
        return `<span class="ib-redacted-open" data-redaction-id="${id}">${text}</span>`;
      }
    );
  }

  /* -------------------------------------------- */

  /**
   * "Name, 5 minutes ago" for a findings page.
   * @param {JournalEntryPage} page
   * @returns {string}
   */
  #byline(page) {
    // The character first: at the table these pages are written by Mara, not by diego.
    const who = page.system.authorName
      || characterName(game.users.get(page.system.author)?.character)
      || game.users.get(page.system.author)?.name
      || game.i18n.localize("INVESTIGATION_BOARD.SomeoneElse");
    let when = null;
    try {
      if ( page.system.createdAt ) when = foundry.utils.timeSince(new Date(page.system.createdAt));
    }
    catch {
      when = null;
    }
    return when ? game.i18n.format("INVESTIGATION_BOARD.WrittenBy", {who, when}) : who;
  }

  /* -------------------------------------------- */
  /*  Actions                                     */
  /* -------------------------------------------- */

  /**
   * Write or rewrite the opening file.
   * @this {CaseFile}
   */
  static async #onEditBrief() {
    const journal = this.currentCase;
    if ( !journal ) return;
    const {default: ReportDialog} = await import("./report-dialog.mjs");
    const brief = getBrief(journal);
    if ( brief ) ReportDialog.edit(brief);
    else ReportDialog.createBrief(journal);
  }

  /* -------------------------------------------- */

  /**
   * Add a findings page.
   * @this {CaseFile}
   */
  static async #onAddFinding() {
    const journal = this.currentCase;
    if ( !journal?.isOwner ) {
      ui.notifications.warn("INVESTIGATION_BOARD.NOTIFY.NoPermission", {localize: true});
      return;
    }
    const {default: ReportDialog} = await import("./report-dialog.mjs");
    ReportDialog.createFinding(journal);
  }

  /* -------------------------------------------- */

  /**
   * Rewrite a findings page.
   * @this {CaseFile}
   * @param {PointerEvent} _event
   * @param {HTMLElement} target
   */
  static async #onEditFinding(_event, target) {
    const page = this.currentCase?.pages.get(target.dataset.pageId);
    if ( !page ) return;
    if ( !canEditReport(page, game.user) ) {
      ui.notifications.warn("INVESTIGATION_BOARD.NOTIFY.NotYourFinding", {localize: true});
      return;
    }
    const {default: ReportDialog} = await import("./report-dialog.mjs");
    ReportDialog.edit(page);
  }

  /* -------------------------------------------- */

  /**
   * Remove a findings page. Its author may withdraw it; the GM may remove any.
   * @this {CaseFile}
   * @param {PointerEvent} _event
   * @param {HTMLElement} target
   */
  static async #onDeleteFinding(_event, target) {
    const page = this.currentCase?.pages.get(target.dataset.pageId);
    if ( !page ) return;
    if ( !game.user.isGM && (page.system.author !== game.user.id) ) {
      ui.notifications.warn("INVESTIGATION_BOARD.NOTIFY.NotYourFinding", {localize: true});
      return;
    }
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: {title: "INVESTIGATION_BOARD.DeleteFinding"},
      content: `<p>${game.i18n.format("INVESTIGATION_BOARD.DeleteFindingConfirm",
        {name: page.name})}</p>`,
      modal: true
    });
    if ( !confirmed ) return;
    await page.delete();
    await this.render();
  }

  /* -------------------------------------------- */

  /**
   * Put a redacted passage back where everyone can read it.
   * @this {CaseFile}
   * @param {PointerEvent} _event
   * @param {HTMLElement} target
   */
  static async #onRevealRedaction(_event, target) {
    const page = this.currentCase?.pages.get(target.dataset.pageId);
    if ( !page ) return;
    await revealPassage(page, target.dataset.redactionId);
    await this.render();
  }

  /* -------------------------------------------- */

  /**
   * Redact whatever the GM has selected in the file.
   * @this {CaseFile}
   * @param {PointerEvent} _event
   * @param {HTMLElement} target
   */
  static async #onRedactSelection(_event, target) {
    const page = this.currentCase?.pages.get(target.dataset.pageId);
    if ( !page ) return;

    const selection = window.getSelection();
    const text = selection?.toString().trim();
    if ( !text ) {
      ui.notifications.info("INVESTIGATION_BOARD.NOTIFY.SelectToRedact", {localize: true});
      return;
    }

    // Matched against the stored body rather than the rendered HTML: what is on screen has been
    // through the enricher and no longer matches what is saved.
    const body = page.system.body ?? "";
    if ( !body.includes(text) ) {
      ui.notifications.warn("INVESTIGATION_BOARD.NOTIFY.RedactNotFound", {localize: true});
      return;
    }

    await redactPassage(page, text, game.i18n.format("INVESTIGATION_BOARD.RedactionLabel",
      {count: text.length}));
    await this.render();
  }

  /* -------------------------------------------- */

  /**
   * Open the file for a case.
   * @param {string} caseId
   * @returns {Promise<CaseFile>}
   */
  static open(caseId) {
    return new this({caseId}).render({force: true});
  }
}
