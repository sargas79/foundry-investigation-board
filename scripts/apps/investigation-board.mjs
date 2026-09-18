import {MODULE_ID, PAGE_TYPES, modulePath} from "../constants.mjs";
import BoardView from "../board/board-view.mjs";
import BoardRenderer from "../board/board-renderer.mjs";
import {caseState, clueBounds, getCases, getClues, isCase} from "../data/case.mjs";

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
   * Pan/zoom controller for the corkboard surface.
   * @type {BoardView|null}
   */
  #view = null;

  /**
   * Remembered pan/zoom per case, so switching away and back returns to the same spot.
   * Client-side only — where a player is looking is not worth syncing.
   * @type {Map<string, {x: number, y: number, scale: number}>}
   */
  #viewStates = new Map();

  /**
   * Draws the current case onto the board and keeps it in step with the documents.
   * @type {BoardRenderer|null}
   */
  #renderer = null;

  /** Cases whose view has already been framed, so opening one doesn't re-fit on every render. */
  #framed = new Set();

  /** The board's pan/zoom controller, once rendered. */
  get view() {
    return this.#view;
  }

  /** The board's renderer, once rendered. */
  get renderer() {
    return this.#renderer;
  }

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
      state: currentCase ? caseState(currentCase) : null,
      cases: getCases().map(j => ({
        id: j.id,
        name: j.name,
        active: j.id === this.#caseId,
        ...caseState(j)
      }))
    });
  }

  /* -------------------------------------------- */

  /** @inheritDoc */
  _onRender(context, options) {
    super._onRender(context, options);
    this.element.classList.toggle("maximized", this.#maximized);
    this.#attachBoardView();
    this.#drawCase();
  }

  /* -------------------------------------------- */

  /**
   * Draw the current case, framing it the first time it is opened.
   * @returns {Promise<void>}
   */
  async #drawCase() {
    if ( !this.#renderer ) return;
    const currentCase = this.currentCase;
    await this.#renderer.render(currentCase);

    if ( !currentCase || this.#framed.has(currentCase.id) ) return;
    this.#framed.add(currentCase.id);
    // Only frame a case the user hasn't already positioned themselves.
    if ( this.#viewStates.has(currentCase.id) ) return;
    const bounds = clueBounds(getClues(currentCase));
    if ( bounds ) this.#view?.fit(bounds);
  }

  /* -------------------------------------------- */

  /**
   * (Re)bind the pan/zoom controller after the board part renders, restoring the view this case
   * was last left at.
   */
  #attachBoardView() {
    const viewport = this.element.querySelector(".ib-board-viewport");
    const world = this.element.querySelector(".ib-board-world");
    if ( !viewport || !world ) return;

    // The board part may have been replaced wholesale; rebind against the new nodes.
    if ( this.#view ) {
      if ( this.#view.viewport.isConnected ) return;
      this.#saveViewState();
      this.#view.destroy();
    }

    this.#view = new BoardView(viewport, world).attach();
    this.#renderer = new BoardRenderer(
      world.querySelector(".ib-clue-layer"),
      world.querySelector(".ib-string-layer")
    );

    const saved = this.#caseId ? this.#viewStates.get(this.#caseId) : null;
    if ( saved ) this.#view.setTransform(saved);
    this.#view.onChange(() => this.#saveViewState());
  }

  /* -------------------------------------------- */

  /** Remember where the current case was left. */
  #saveViewState() {
    if ( this.#caseId && this.#view ) this.#viewStates.set(this.#caseId, this.#view.transform);
  }

  /* -------------------------------------------- */

  /** @inheritDoc */
  _onClose(options) {
    this.#saveViewState();
    this.#view?.destroy();
    this.#renderer?.clear();
    this.#view = null;
    this.#renderer = null;
    super._onClose(options);
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
    if ( caseId === undefined ) this.#caseId ??= getCases()[0]?.id ?? null;
    else this.#caseId = caseId;
    await this.render({force: true});
    if ( this.minimized ) await this.maximize();
    this.bringToFront();
    return this;
  }

  /* -------------------------------------------- */

  /**
   * Switch to a different case.
   * @param {string|null} caseId
   * @returns {Promise<void>}
   */
  async showCase(caseId) {
    if ( caseId === this.#caseId ) return;
    this.#saveViewState();
    this.#caseId = caseId;
    await this.render();
  }

  /* -------------------------------------------- */
  /*  Document synchronisation                    */
  /* -------------------------------------------- */

  /**
   * Apply a page change to the board without a full re-render, so a drag in progress and the
   * current selection both survive another player's edit.
   * @param {JournalEntryPage} page
   * @param {"upsert"|"delete"} action
   * @returns {Promise<void>}
   */
  async onPageChange(page, action) {
    if ( !this.rendered || (page.parent?.id !== this.#caseId) || !this.#renderer ) return;
    if ( page.type === PAGE_TYPES.CLUE ) {
      if ( action === "delete" ) this.#renderer.removeClue(page.id);
      else await this.#renderer.upsertClue(page);
    }
    else if ( page.type === PAGE_TYPES.CONNECTION ) {
      if ( action === "delete" ) this.#renderer.removeConnection(page.id);
      else this.#renderer.upsertConnection(page);
    }
  }

  /* -------------------------------------------- */

  /**
   * React to a case document itself changing — a rename, a status change, or its deletion.
   * @param {JournalEntry} journal
   * @param {"update"|"delete"} action
   * @returns {Promise<void>}
   */
  async onCaseChange(journal, action) {
    if ( !this.rendered || !isCase(journal) ) return;
    if ( (action === "delete") && (journal.id === this.#caseId) ) {
      this.#caseId = getCases()[0]?.id ?? null;
    }
    await this.render();
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
