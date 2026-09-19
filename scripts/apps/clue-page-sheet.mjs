import {
  CATEGORIES,
  CLUE_TEMPLATES,
  HANDOUT_KINDS,
  MODULE_ID,
  RELIABILITY,
  modulePath
} from "../constants.mjs";
import {bindLeadsPicker} from "../data/uploads.mjs";

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

  /* -------------------------------------------- */

  /**
   * @inheritDoc
   * A clue edited from the journal sidebar uploads to the same folder as one edited on the board.
   */
  async _onRender(context, options) {
    await super._onRender(context, options);
    bindLeadsPicker(this.element);
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

/* -------------------------------------------- */

/**
 * The native journal sheet for a handout page — and the only place a handout is ever *read*.
 *
 * Unlike the other sheets here, this one is not a fallback for a window that normally does the job.
 * The board's documents tab lists handouts and opens them, but opening one means opening its
 * journal entry, which lands exactly here. Going through core rather than a window of this module's
 * means a handout looks the same however it was reached — from the board, from the journal
 * directory, or from a link pasted into chat — and that a GM keeps core's own controls, "Show to
 * Players" among them.
 *
 * The particulars can be edited here too, but only the rows that already exist: adding and removing
 * them is the dialog's job, since a plain document form has nowhere to put the buttons.
 */
export class HandoutPageSheet extends JournalEntryPageHandlebarsSheet {

  /** @override */
  static DEFAULT_OPTIONS = {
    classes: [MODULE_ID, "handout-page"],
    window: {icon: "fa-solid fa-file-lines"}
  };

  /** @inheritDoc */
  static EDIT_PARTS = {
    header: super.EDIT_PARTS.header,
    content: {template: modulePath("templates/page/handout-edit.hbs"), classes: ["standard-form"]},
    footer: super.EDIT_PARTS.footer
  };

  /** @override */
  static VIEW_PARTS = {
    content: {template: modulePath("templates/page/handout-view.hbs"), root: true}
  };

  /* -------------------------------------------- */

  /** @inheritDoc */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const handout = this.page.system;
    const config = HANDOUT_KINDS[handout.kind] ?? HANDOUT_KINDS.document;

    return Object.assign(context, {
      handout,
      icon: config.icon,
      portrait: config.portrait,
      kindLabel: game.i18n.localize(config.label),
      // Blank rows are the seeded fields the GM had no answer for; printing them would put empty
      // rules across the document.
      rows: handout.filledRows,
      enrichedBody: await foundry.applications.ux.TextEditor.implementation.enrichHTML(
        handout.body ?? "", {relativeTo: this.page, secrets: this.page.isOwner}
      )
    });
  }

  /* -------------------------------------------- */

  /** @inheritDoc */
  async _onRender(context, options) {
    await super._onRender(context, options);
    bindLeadsPicker(this.element);
  }
}
