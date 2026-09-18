import {MODULE_ID, PAGE_TYPES, modulePath} from "../constants.mjs";
import BoardView from "../board/board-view.mjs";
import BoardRenderer from "../board/board-renderer.mjs";
import BoardInteractions from "../board/interactions.mjs";
import DropHandler from "../board/drop-handler.mjs";
import ClueDialog from "./clue-dialog.mjs";
import {
  caseState,
  clueBounds,
  dismissClue,
  freeSpotNear,
  getCases,
  getClues,
  getDismissed,
  isCase,
  recoverClue,
  topZ
} from "../data/case.mjs";

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
      toggleMaximize: InvestigationBoard.#onToggleMaximize,
      selectCase: InvestigationBoard.#onSelectCase,
      pinEvidence: InvestigationBoard.#onPinEvidence,
      createLead: InvestigationBoard.#onCreateLead,
      toggleTray: InvestigationBoard.#onToggleTray,
      dismissClue: InvestigationBoard.#onDismissClue,
      recoverClue: InvestigationBoard.#onRecoverClue,
      deleteClue: InvestigationBoard.#onDeleteClue
    }
  };

  /** @override */
  static PARTS = {
    sidebar: {template: modulePath("templates/sidebar.hbs")},
    header: {template: modulePath("templates/header.hbs")},
    board: {template: modulePath("templates/board.hbs")},
    tray: {template: modulePath("templates/tray.hbs")},
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

  /**
   * Pointer and keyboard handling for the cards.
   * @type {BoardInteractions|null}
   */
  #interactions = null;

  /**
   * Turns documents dropped on the cork into clues.
   * @type {DropHandler|null}
   */
  #drops = null;

  /**
   * A clue to drop straight into in-place editing once it has been drawn — how a new lead gets
   * its text without a dialog.
   * @type {string|null}
   */
  #pendingInlineEdit = null;

  /** Whether the discarded tray drawer is showing. */
  #trayOpen = false;

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
      })),
      trayOpen: this.#trayOpen,
      dismissed: currentCase ? getDismissed(currentCase).map(page => ({
        id: page.id,
        name: page.name,
        image: page.system.image,
        template: page.system.template,
        dismissedLabel: this.#dismissedLabel(page)
      })) : []
    });
  }

  /* -------------------------------------------- */

  /**
   * A short "discarded by X, when" line for a tray entry.
   * @param {JournalEntryPage} page
   * @returns {string}
   */
  #dismissedLabel(page) {
    const who = game.users.get(page.system.dismissedBy)?.name;
    let when = null;
    // timeSince leans on the world clock; a label is never worth failing a render over.
    try {
      if ( page.system.dismissedAt ) when = foundry.utils.timeSince(new Date(page.system.dismissedAt));
    }
    catch {
      when = null;
    }
    if ( who && when ) return game.i18n.format("INVESTIGATION_BOARD.DismissedBy", {who, when});
    if ( who ) return game.i18n.format("INVESTIGATION_BOARD.DismissedByOnly", {who});
    return game.i18n.localize("INVESTIGATION_BOARD.DismissedUnknown");
  }

  /* -------------------------------------------- */

  /**
   * @inheritDoc
   * Async because core awaits this hook: drawing the case must finish before the render is
   * considered complete, and any failure while enriching clue bodies must surface as a rejected
   * render rather than an unhandled promise.
   */
  async _onRender(context, options) {
    await super._onRender(context, options);
    this.element.classList.toggle("maximized", this.#maximized);
    this.#attachBoardView();
    await this.#drawCase();
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

    this.#consumePendingInlineEdit();

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
      this.#interactions?.destroy();
      this.#drops?.destroy();
    }

    this.#view = new BoardView(viewport, world).attach();
    this.#renderer = new BoardRenderer(
      world.querySelector(".ib-clue-layer"),
      world.querySelector(".ib-string-layer")
    );
    this.#interactions = new BoardInteractions({
      viewport,
      view: this.#view,
      renderer: this.#renderer,
      getCase: () => this.currentCase,
      onEdit: page => ClueDialog.edit(page),
      onDismiss: page => dismissClue(page)
    }).attach();
    this.#drops = new DropHandler({
      viewport,
      view: this.#view,
      getCase: () => this.currentCase
    }).attach();

    const saved = this.#caseId ? this.#viewStates.get(this.#caseId) : null;
    if ( saved ) this.#view.setTransform(saved);
    this.#view.onChange(() => this.#saveViewState());
  }

  /* -------------------------------------------- */

  /**
   * Drop a newly created lead straight into in-place editing, once its card exists.
   *
   * The card arrives through the create hook rather than a full render, so this is checked from
   * both paths — whichever draws the card first wins.
   */
  #consumePendingInlineEdit() {
    const clueId = this.#pendingInlineEdit;
    if ( !clueId || !this.#renderer?.cards.has(clueId) ) return;
    this.#pendingInlineEdit = null;
    this.#interactions?.select(clueId);
    this.#interactions?.beginInlineEdit(clueId, "body");
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
    // Destroying the interaction layer saves any text still being typed on a card.
    this.#interactions?.destroy();
    this.#drops?.destroy();
    this.#view?.destroy();
    this.#renderer?.clear();
    this.#interactions = null;
    this.#drops = null;
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
      if ( action === "delete" ) {
        this.#renderer.removeClue(page.id);
        if ( this.#interactions?.selected === page.id ) this.#interactions.select(null);
      }
      else {
        await this.#renderer.upsertClue(page);
        this.#consumePendingInlineEdit();
      }
      // A clue moving to or from the tray changes what the drawer and its badge show.
      await this.render({parts: ["tray", "toolbar"]});
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

  /* -------------------------------------------- */

  /**
   * Switch the board to another case file.
   * @this {InvestigationBoard}
   * @param {PointerEvent} _event
   * @param {HTMLElement} target
   */
  static async #onSelectCase(_event, target) {
    await this.showCase(target.dataset.caseId);
  }

  /* -------------------------------------------- */

  /**
   * Open the Pin Evidence dialog, dropping the new clue near the middle of what the user is
   * currently looking at rather than at the board's origin.
   * @this {InvestigationBoard}
   */
  static #onPinEvidence() {
    const currentCase = this.#writableCase();
    if ( !currentCase ) return;
    ClueDialog.pin(currentCase, this.#view?.center ?? {x: 0, y: 0});
  }

  /* -------------------------------------------- */

  /**
   * Drop a sticky note on the board and start typing into it.
   *
   * A lead is a half-formed thought — a hunch, a thing to check — so it deliberately skips the
   * dialog: one click puts the note down and the caret is already in it.
   * @this {InvestigationBoard}
   * @returns {Promise<void>}
   */
  static async #onCreateLead() {
    const currentCase = this.#writableCase();
    if ( !currentCase ) return;

    const spot = freeSpotNear(currentCase, this.#view?.center ?? {x: 0, y: 0});
    const [page] = await currentCase.createEmbeddedDocuments("JournalEntryPage", [{
      name: game.i18n.localize("INVESTIGATION_BOARD.NewLead"),
      type: PAGE_TYPES.CLUE,
      system: {
        template: "sticky",
        category: "lead",
        reliability: "unverified",
        pinColor: "yellow",
        body: "",
        x: spot.x,
        y: spot.y,
        z: topZ(currentCase) + 1,
        width: 180,
        rotation: Math.round(((Math.random() * 10) - 5) * 10) / 10
      }
    }]);

    // The card is drawn by the create hook; editing begins as soon as it exists.
    if ( page ) this.#pendingInlineEdit = page.id;
  }

  /* -------------------------------------------- */

  /**
   * Open or close the discarded tray.
   * @this {InvestigationBoard}
   */
  static async #onToggleTray() {
    this.#trayOpen = !this.#trayOpen;
    await this.render({parts: ["tray", "toolbar"]});
  }

  /* -------------------------------------------- */

  /**
   * Take a clue off the board. Its connections are kept, so recovering it restores everything it
   * was tied to.
   * @this {InvestigationBoard}
   * @param {PointerEvent} _event
   * @param {HTMLElement} target
   */
  static async #onDismissClue(_event, target) {
    const page = this.#clueFrom(target);
    if ( !page ) return;
    if ( this.#interactions?.selected === page.id ) this.#interactions.select(null);
    await dismissClue(page);
  }

  /* -------------------------------------------- */

  /**
   * Put a dismissed clue back on the board.
   * @this {InvestigationBoard}
   * @param {PointerEvent} _event
   * @param {HTMLElement} target
   */
  static async #onRecoverClue(_event, target) {
    const page = this.#clueFrom(target);
    if ( !page ) return;
    await recoverClue(page);
    await this.render({parts: ["tray", "toolbar"]});
  }

  /* -------------------------------------------- */

  /**
   * Destroy a clue and the strings attached to it. GM only — players dismiss instead.
   * @this {InvestigationBoard}
   * @param {PointerEvent} _event
   * @param {HTMLElement} target
   */
  static async #onDeleteClue(_event, target) {
    if ( !game.user.isGM ) {
      ui.notifications.warn("INVESTIGATION_BOARD.NOTIFY.DeleteIsGMOnly", {localize: true});
      return;
    }
    const page = this.#clueFrom(target);
    if ( !page ) return;

    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: {title: "INVESTIGATION_BOARD.DeleteForever"},
      content: `<p>${game.i18n.format("INVESTIGATION_BOARD.DeleteConfirm", {name: page.name})}</p>`,
      modal: true
    });
    if ( !confirmed ) return;

    // The clue and every string touching it go in one operation, so no dangling string can
    // survive even momentarily.
    const journal = page.parent;
    const connections = journal.pages.filter(p => {
      return (p.type === PAGE_TYPES.CONNECTION) && p.system.touches?.(page.id);
    });
    await journal.deleteEmbeddedDocuments("JournalEntryPage",
      [page.id, ...connections.map(p => p.id)]);
    await this.render({parts: ["tray", "toolbar"]});
  }

  /* -------------------------------------------- */

  /**
   * The clue page a tray or card control refers to.
   * @param {HTMLElement} target
   * @returns {JournalEntryPage|null}
   */
  #clueFrom(target) {
    const clueId = target.dataset.clueId ?? target.closest("[data-clue-id]")?.dataset.clueId;
    if ( !clueId ) return null;
    const page = this.currentCase?.pages.get(clueId);
    if ( !page?.isOwner ) {
      ui.notifications.warn("INVESTIGATION_BOARD.NOTIFY.NoPermission", {localize: true});
      return null;
    }
    return page;
  }

  /* -------------------------------------------- */

  /**
   * The current case, if it can be written to, warning the user if not.
   * @returns {JournalEntry|null}
   */
  #writableCase() {
    const currentCase = this.currentCase;
    if ( !currentCase ) return null;
    if ( !currentCase.isOwner ) {
      ui.notifications.warn("INVESTIGATION_BOARD.NOTIFY.NoPermission", {localize: true});
      return null;
    }
    return currentCase;
  }
}
