import {CATEGORIES, CLUE_TEMPLATES, MODULE_ID, RELIABILITY, modulePath} from "../constants.mjs";

const {JournalEntryPageHandlebarsSheet} = foundry.applications.sheets.journal;

/**
 * The native journal sheet for a clue page.
 *
 * Clues are normally created and edited through the Investigation Board window, but a case is an
 * ordinary JournalEntry — so a clue page can also be opened from the journal sidebar. This sheet
 * keeps that path working rather than leaving core without a sheet class to instantiate.
 */
export class CluePageSheet extends JournalEntryPageHandlebarsSheet {

  /** @override */
  static DEFAULT_OPTIONS = {
    classes: [MODULE_ID, "clue-page"],
    window: {icon: "fa-solid fa-thumbtack"}
  };

  /** @inheritDoc */
  static EDIT_PARTS = {
    header: super.EDIT_PARTS.header,
    content: {
      template: modulePath("templates/page/clue-edit.hbs"),
      classes: ["standard-form"]
    },
    footer: super.EDIT_PARTS.footer
  };

  /** @override */
  static VIEW_PARTS = {
    content: {
      template: modulePath("templates/page/clue-view.hbs"),
      root: true
    }
  };

  /* -------------------------------------------- */

  /** @inheritDoc */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const clue = this.page.system;
    return Object.assign(context, {
      clue,
      templateChoices: Object.fromEntries(
        Object.entries(CLUE_TEMPLATES).map(([k, v]) => [k, game.i18n.localize(v.label)])
      ),
      categoryChoices: Object.fromEntries(
        Object.entries(CATEGORIES).map(([k, v]) => [k, game.i18n.localize(v)])
      ),
      reliabilityChoices: Object.fromEntries(
        Object.entries(RELIABILITY).map(([k, v]) => [k, game.i18n.localize(v)])
      ),
      enrichedBody: await foundry.applications.ux.TextEditor.implementation.enrichHTML(clue.body, {
        relativeTo: this.page,
        secrets: this.page.isOwner
      })
    });
  }
}

/* -------------------------------------------- */

/**
 * The native journal sheet for a case-file page.
 *
 * The file is meant to be read in the case-file window, but a page is still an ordinary journal
 * page and can be opened from the sidebar — so core needs a sheet to instantiate. Redacted
 * passages show as bars here too: the text is not in this document at all.
 */
export class ReportPageSheet extends JournalEntryPageHandlebarsSheet {

  /** @override */
  static DEFAULT_OPTIONS = {
    classes: [MODULE_ID, "report-page"],
    window: {icon: "fa-solid fa-file-lines"}
  };

  /** @inheritDoc */
  static EDIT_PARTS = {
    header: super.EDIT_PARTS.header,
    content: {template: modulePath("templates/page/report-edit.hbs"), classes: ["standard-form"]},
    footer: super.EDIT_PARTS.footer
  };

  /** @override */
  static VIEW_PARTS = {
    content: {template: modulePath("templates/page/report-view.hbs"), root: true}
  };

  /** @inheritDoc */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const report = this.page.system;
    return Object.assign(context, {
      report,
      enrichedBody: await foundry.applications.ux.TextEditor.implementation.enrichHTML(
        report.body ?? "", {relativeTo: this.page, secrets: this.page.isOwner}
      )
    });
  }
}

/* -------------------------------------------- */

/**
 * The native journal sheet for a connection page.
 *
 * Connections carry no authored content — they are pure structure between two clues — so this sheet
 * exists mainly so core has something to instantiate, and shows a read-only summary.
 */
export class ConnectionPageSheet extends JournalEntryPageHandlebarsSheet {

  /** @override */
  static DEFAULT_OPTIONS = {
    classes: [MODULE_ID, "connection-page"],
    window: {icon: "fa-solid fa-link"}
  };

  /** @inheritDoc */
  static EDIT_PARTS = {
    header: super.EDIT_PARTS.header,
    content: {
      template: modulePath("templates/page/connection-edit.hbs"),
      classes: ["standard-form"]
    },
    footer: super.EDIT_PARTS.footer
  };

  /** @override */
  static VIEW_PARTS = {
    content: {
      template: modulePath("templates/page/connection-view.hbs"),
      root: true
    }
  };

  /* -------------------------------------------- */

  /** @inheritDoc */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const {from, to} = this.page.system;
    const pages = this.page.parent?.pages;
    return Object.assign(context, {
      connection: this.page.system,
      fromName: pages?.get(from)?.name ?? game.i18n.localize("INVESTIGATION_BOARD.MissingClue"),
      toName: pages?.get(to)?.name ?? game.i18n.localize("INVESTIGATION_BOARD.MissingClue")
    });
  }
}
