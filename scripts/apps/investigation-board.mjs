import {MODULE_ID, modulePath} from "../constants.mjs";

const {ApplicationV2, HandlebarsApplicationMixin} = foundry.applications.api;

/**
 * The Investigation Board window.
 *
 * A single shared instance; opening the board again focuses the existing window rather than
 * spawning a second one. Laid out as five Handlebars parts placed into a CSS grid:
 *
 *     ┌─────────┬────────────────┬───────────┐
 *     │         │     header     │           │
 *     │ sidebar ├────────────────┤ inspector │
 *     │         │     board      │           │
 *     │         │   (toolbar)    │           │
 *     └─────────┴────────────────┴───────────┘
 *
 * The toolbar floats over the bottom of the board rather than taking a grid row of its own.
 */
export default class InvestigationBoard extends HandlebarsApplicationMixin(ApplicationV2) {

  /** @override */
  static DEFAULT_OPTIONS = {
    id: MODULE_ID,
    classes: [MODULE_ID, "investigation-board-app"],
    tag: "div",
    window: {
      title: "INVESTIGATION_BOARD.AppTitle",
      icon: "fa-solid fa-thumbtack",
      resizable: true,
      minimizable: true,
      contentClasses: ["investigation-board-content"]
    },
    position: {width: 1400, height: 820},
    actions: {
      toggleMaximize: InvestigationBoard.#onToggleMaximize
    }
  };

  /** @override */
  static PARTS = {
    sidebar: {template: modulePath("templates/sidebar.hbs")},
    header: {template: modulePath("templates/header.hbs")},
    board: {template: modulePath("templates/board.hbs")},
    toolbar: {template: modulePath("templates/toolbar.hbs")},
    inspector: {template: modulePath("templates/inspector.hbs")}
  };

  /* -------------------------------------------- */
  /*  State                                       */
  /* -------------------------------------------- */

  /**
   * The id of the JournalEntry currently displayed, or null when no case is open.
   * @type {string|null}
   */
  #caseId = null;

  /** Whether the window is currently expanded to fill the viewport. */
  #maximized = false;

  /**
   * The case currently being viewed.
   * @type {JournalEntry|null}
   */
  get currentCase() {
    return this.#caseId ? (game.journal.get(this.#caseId) ?? null) : null;
  }

  /* -------------------------------------------- */
  /*  Rendering                                   */
  /* -------------------------------------------- */

  /** @inheritDoc */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const currentCase = this.currentCase;
    return Object.assign(context, {
      moduleId: MODULE_ID,
      isGM: game.user.isGM,
      currentCase,
      hasCase: !!currentCase,
      // Populated in milestone 5; the shell renders an empty sidebar until then.
      cases: []
    });
  }

  /* -------------------------------------------- */

  /** @inheritDoc */
  _onRender(context, options) {
    super._onRender(context, options);
    this.element.classList.toggle("maximized", this.#maximized);
  }

  /* -------------------------------------------- */
  /*  Public API                                  */
  /* -------------------------------------------- */

  /**
   * Open the board, optionally on a specific case.
   * @param {string} [caseId]   The JournalEntry id of a case to display.
   * @returns {Promise<InvestigationBoard>}
   */
  async open(caseId) {
    if ( caseId !== undefined ) this.#caseId = caseId;
    await this.render({force: true});
    if ( this.minimized ) await this.maximize();
    this.bringToFront();
    return this;
  }

  /* -------------------------------------------- */
  /*  Event Handlers                              */
  /* -------------------------------------------- */

  /**
   * Expand the window to fill the viewport, or restore it to its previous size.
   * @this {InvestigationBoard}
   * @param {PointerEvent} _event
   * @param {HTMLElement} _target
   */
  static #onToggleMaximize(_event, _target) {
    this.#maximized = !this.#maximized;
    this.element.classList.toggle("maximized", this.#maximized);
    if ( this.#maximized ) {
      this.#restorePosition = {...this.position};
      this.setPosition({left: 0, top: 0, width: window.innerWidth, height: window.innerHeight});
    }
    else if ( this.#restorePosition ) this.setPosition(this.#restorePosition);
  }

  /** Position to return to when un-maximizing. */
  #restorePosition = null;
}
