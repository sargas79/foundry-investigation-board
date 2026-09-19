import {CASE_FLAGS, MODULE_ID, PAGE_TYPES, modulePath} from "../constants.mjs";
import BoardView from "../board/board-view.mjs";
import BoardRenderer from "../board/board-renderer.mjs";
import BoardInteractions from "../board/interactions.mjs";
import DropHandler from "../board/drop-handler.mjs";
import ClueDialog from "./clue-dialog.mjs";
import CaseConfig from "./case-config.mjs";
import CaseFile from "./case-file.mjs";
import ShareDialog from "./share-dialog.mjs";
import {canCreateDirectly, createCase} from "../data/case-create.mjs";
import {canManageSharing} from "../data/sharing.mjs";
import {buildImport, exportCase, exportFilename, validateExport} from "../data/transfer.mjs";
import {announce, clearPresence, holderOf, watchPresence} from "../presence.mjs";
import {authorColor, authorName, authorStamp} from "../data/authorship.mjs";
import {CATEGORIES, RELIABILITY} from "../constants.mjs";
import {EMPTY_FILTER, applyFilter, isActive} from "../board/filter.mjs";
import {
  archiveCase,
  canConnect,
  canDeleteCase,
  caseState,
  clueBounds,
  dismissClue,
  freeSpotNear,
  getCases,
  getClues,
  getConnectionsFor,
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
      createCase: InvestigationBoard.#onCreateCase,
      configureCase: InvestigationBoard.#onConfigureCase,
      useHand: InvestigationBoard.#onUseHand,
      pinEvidence: InvestigationBoard.#onPinEvidence,
      createLead: InvestigationBoard.#onCreateLead,
      drawConnection: InvestigationBoard.#onDrawConnection,
      toggleTray: InvestigationBoard.#onToggleTray,
      dismissClue: InvestigationBoard.#onDismissClue,
      recoverClue: InvestigationBoard.#onRecoverClue,
      deleteClue: InvestigationBoard.#onDeleteClue,
      linkFromSelected: InvestigationBoard.#onLinkFromSelected,
      addNote: InvestigationBoard.#onAddNote,
      openLinked: InvestigationBoard.#onOpenLinked,
      focusConnection: InvestigationBoard.#onFocusConnection,
      cutConnection: InvestigationBoard.#onCutConnection,
      toggleFilter: InvestigationBoard.#onToggleFilter,
      clearFilter: InvestigationBoard.#onClearFilter,
      shareCase: InvestigationBoard.#onShareCase,
      archiveCase: InvestigationBoard.#onArchiveCase,
      deleteCase: InvestigationBoard.#onDeleteCase,
      openCaseFile: InvestigationBoard.#onOpenCaseFile,
      exportCase: InvestigationBoard.#onExportCase,
      importCase: InvestigationBoard.#onImportCase
    }
  };

  /** @override */
  static PARTS = {
    sidebar: {template: modulePath("templates/sidebar.hbs")},
    header: {template: modulePath("templates/header.hbs")},
    board: {template: modulePath("templates/board.hbs")},
    tray: {template: modulePath("templates/tray.hbs")},
    filter: {template: modulePath("templates/filter.hbs")},
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

  /** How the case list is grouped: "all", "status" or "classification". */
  #grouping = "all";

  /** The clue the inspector is showing. */
  #selectedClue = null;

  /** Whether the filter popover is showing. */
  #filterOpen = false;

  /** The active filter. */
  #filter = {...EMPTY_FILTER};

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
      canShare: currentCase ? canManageSharing(currentCase, game.user) : false,
      ...this.#sidebarContext(),
      trayOpen: this.#trayOpen,
      linkMode: !!this.#interactions?.linkMode,
      // The hand is what is in use whenever nothing else has been picked up.
      handActive: !!currentCase && !this.#interactions?.linkMode && !this.#filterOpen,
      ...this.#inspectorContext(),
      ...this.#filterContext(),
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
   * The filter popover's state, and who has touched clues in this case.
   * @returns {object}
   */
  #filterContext() {
    const journal = this.currentCase;
    const localized = record => Object.entries(record).map(([value, label]) => ({
      value,
      label: game.i18n.localize(label)
    }));

    // Only offer authors who have actually touched a clue here; a world's full user list is
    // mostly noise for one case.
    const authorIds = new Set(getClues(journal).map(p => p._stats?.lastModifiedBy).filter(Boolean));
    const authors = [...authorIds].map(id => ({
      value: id,
      label: game.users.get(id)?.name ?? game.i18n.localize("INVESTIGATION_BOARD.SomeoneElse")
    }));

    let filterSummary = "";
    if ( journal && isActive(this.#filter) ) {
      const {clues, total} = applyFilter(journal, this.#filter);
      filterSummary = game.i18n.format("INVESTIGATION_BOARD.FilterCount",
        {shown: clues.size, total});
    }

    return {
      filterOpen: this.#filterOpen,
      filter: this.#filter,
      filterActive: isActive(this.#filter),
      filterSummary,
      authors,
      categories: localized(CATEGORIES),
      reliabilities: localized(RELIABILITY)
    };
  }

  /* -------------------------------------------- */

  /**
   * Show who else has hold of a card.
   *
   * Only a class and a label change, so this never disturbs a drag of your own in progress.
   */
  #paintPresence() {
    if ( !this.#renderer ) return;
    for ( const [clueId, el] of this.#renderer.cards ) {
      const holder = holderOf(clueId);
      el.classList.toggle("held", !!holder);
      if ( holder ) {
        el.style.setProperty("--ib-holder", holder.color);
        el.dataset.heldBy = holder.name;
      }
      else {
        el.style.removeProperty("--ib-holder");
        delete el.dataset.heldBy;
      }
    }
  }

  /* -------------------------------------------- */

  /**
   * Dim whatever the filter excludes, leaving every card where it is.
   */
  #applyFilterToBoard() {
    if ( !this.#renderer ) return;
    const journal = this.currentCase;

    if ( !journal || !isActive(this.#filter) ) {
      for ( const el of this.#renderer.cards.values() ) el.classList.remove("dimmed");
      this.#renderer.strings.setFiltered(null);
      return;
    }

    const {clues, connections} = applyFilter(journal, this.#filter);
    for ( const [id, el] of this.#renderer.cards ) el.classList.toggle("dimmed", !clues.has(id));
    this.#renderer.strings.setFiltered(connections);
  }

  /* -------------------------------------------- */

  /**
   * The selected clue's details, its strings and its notes.
   * @returns {object}
   */
  #inspectorContext() {
    const localized = record => Object.entries(record).map(([value, label]) => ({
      value,
      label: game.i18n.localize(label)
    }));
    const base = {
      categories: localized(CATEGORIES),
      reliabilities: localized(RELIABILITY)
    };

    const journal = this.currentCase;
    const page = this.#selectedClue ? journal?.pages.get(this.#selectedClue) : null;
    if ( !page ) return {...base, clue: null, connections: []};

    return {
      ...base,
      clue: {
        id: page.id,
        name: page.name,
        category: page.system.category,
        reliability: page.system.reliability,
        linkedUuid: page.system.linkedUuid,
        editable: page.isOwner,
        author: authorName(page.system),
        authorColor: authorColor(page.system),
        pinnedAt: this.#pinnedAt(page),
        notes: (page.system.notes ?? []).map(note => ({
          text: note.text,
          byline: this.#noteByline(note)
        }))
      },
      connections: getConnectionsFor(journal, page.id).map(connection => ({
        id: connection.id,
        color: connection.system.color,
        label: connection.system.label,
        otherName: journal.pages.get(connection.system.other(page.id))?.name
          ?? game.i18n.localize("INVESTIGATION_BOARD.MissingClue")
      }))
    };
  }

  /* -------------------------------------------- */

  /**
   * When a clue was pinned, in words.
   * @param {JournalEntryPage} page
   * @returns {string|null}
   */
  #pinnedAt(page) {
    try {
      return page.system.createdAt
        ? foundry.utils.timeSince(new Date(page.system.createdAt))
        : null;
    }
    catch {
      return null;
    }
  }

  /* -------------------------------------------- */

  /**
   * "Name, 5 minutes ago" for a clue note.
   * @param {{author: string, time: number}} note
   * @returns {string}
   */
  #noteByline(note) {
    const who = game.users.get(note.author)?.name
      ?? game.i18n.localize("INVESTIGATION_BOARD.SomeoneElse");
    let when = null;
    try {
      if ( note.time ) when = foundry.utils.timeSince(new Date(note.time));
    }
    catch {
      when = null;
    }
    return when ? `${who} — ${when}` : who;
  }

  /* -------------------------------------------- */

  /**
   * The case list, grouped as the user asked.
   *
   * Archived cases are always pushed into their own group at the bottom whatever the grouping, so
   * a finished case never sits between two live ones.
   * @returns {{groups: object[], groupings: object[]}}
   */
  #sidebarContext() {
    const cases = getCases({includeArchived: true}).map(j => ({
      id: j.id,
      name: j.name,
      active: j.id === this.#caseId,
      isOwner: j.isOwner,
      ...caseState(j)
    }));

    const grouped = new Map();
    const push = (key, label, entry) => {
      if ( !grouped.has(key) ) grouped.set(key, {label, cases: []});
      grouped.get(key).cases.push(entry);
    };

    for ( const entry of cases ) {
      if ( entry.archived ) {
        push("~archived", game.i18n.localize("INVESTIGATION_BOARD.Archived"), entry);
        continue;
      }
      switch ( this.#grouping ) {
        case "status":
          push(entry.status, game.i18n.localize(entry.statusLabel), entry);
          break;
        case "classification":
          push(entry.classification || "~none",
            entry.classification || game.i18n.localize("INVESTIGATION_BOARD.Unclassified"), entry);
          break;
        default:
          push("all", game.i18n.localize("INVESTIGATION_BOARD.CaseFiles"), entry);
      }
    }

    // Archived last; everything else alphabetically by group, then by case name.
    const groups = [...grouped.entries()]
      .sort(([a], [b]) => {
        if ( a.startsWith("~") !== b.startsWith("~") ) return a.startsWith("~") ? 1 : -1;
        return a.localeCompare(b);
      })
      .map(([, group]) => {
        group.cases.sort((x, y) => x.name.localeCompare(y.name));
        return group;
      });

    return {
      groups,
      groupings: [
        {value: "all", label: game.i18n.localize("INVESTIGATION_BOARD.GroupAll")},
        {value: "status", label: game.i18n.localize("INVESTIGATION_BOARD.GroupStatus")},
        {value: "classification", label: game.i18n.localize("INVESTIGATION_BOARD.GroupClassification")}
      ].map(g => ({...g, selected: g.value === this.#grouping}))
    };
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

    // A select needs "change"; an action would fire on the click that opens it.
    this.#bindOnce(this.element.querySelector(".ib-group-by"), "change", async event => {
      this.#grouping = event.target.value;
      await this.render({parts: ["sidebar"]});
    });

    this.#bindProgress();
    this.#bindInspectorFields();
    this.#bindFilterFields();

    this.#attachBoardView();
    await this.#drawCase();
  }

  /* -------------------------------------------- */

  /**
   * Which events each element has already been wired for.
   *
   * Keyed by element *and* event type, since one element can legitimately want two listeners —
   * the progress slider wants both `input` and `change`. Weak, so an element replaced by a
   * re-render is not kept alive merely by being remembered here.
   * @type {WeakMap<Element, Set<string>>}
   */
  #bound = new WeakMap();

  /**
   * Attach a listener to an element exactly once, however many times this runs.
   *
   * Foundry calls `_onRender` after *every* render, partial ones included, and a partial render
   * leaves the other parts' elements in place. Binding unconditionally would therefore stack a
   * fresh listener on the untouched parts each time — and partial renders happen constantly, on
   * every clue change and every selection. Left alone, one rename would fire as many document
   * updates as there had been renders.
   *
   * @param {Element|null} element
   * @param {string} type
   * @param {(event: Event) => void} handler
   */
  #bindOnce(element, type, handler) {
    if ( !element ) return;
    let types = this.#bound.get(element);
    if ( !types ) this.#bound.set(element, types = new Set());
    if ( types.has(type) ) return;
    types.add(type);
    element.addEventListener(type, handler);
  }

  /* -------------------------------------------- */

  /**
   * Wire the filter's fields.
   *
   * The text box filters as you type — the board responding live is the whole point — while the
   * selects apply on change. Neither writes anything: a filter is one player's view, not state
   * the others should see.
   */
  #bindFilterFields() {
    const panel = this.element.querySelector('[data-application-part="filter"]');
    if ( !panel ) return;

    const update = async (field, value, rerenderChrome) => {
      this.#filter = {...this.#filter, [field]: value};
      this.#applyFilterToBoard();
      if ( rerenderChrome ) await this.render({parts: ["filter", "toolbar"]});
      else {
        // Keep the count and the tool's badge honest without rebuilding the field being typed in.
        const summary = panel.querySelector(".ib-filter-count");
        if ( summary ) summary.textContent = this.#filterContext().filterSummary;
        this.element.querySelector('[data-action="toggleFilter"]')
          ?.classList.toggle("active", isActive(this.#filter));
      }
    };

    this.#bindOnce(panel.querySelector('[name="text"]'), "input",
      event => update("text", event.target.value, false));

    for ( const select of panel.querySelectorAll("select[name]") ) {
      this.#bindOnce(select, "change",
        event => update(event.target.name, event.target.value, true));
    }
  }

  /* -------------------------------------------- */

  /**
   * Save the inspector's name, category and reliability as they are changed.
   *
   * Written on "change" rather than every keystroke, so renaming a clue is one update rather than
   * one per character.
   */
  #bindInspectorFields() {
    const panel = this.element.querySelector('[data-application-part="inspector"]');
    if ( !panel ) return;

    const save = async (field, value) => {
      const page = this.currentCase?.pages.get(this.#selectedClue);
      if ( !page?.isOwner ) return;
      if ( field === "name" ) {
        const name = value.trim() || game.i18n.localize("INVESTIGATION_BOARD.UntitledClue");
        if ( name !== page.name ) await page.update({name});
      }
      else if ( value !== page.system[field] ) await page.update({system: {[field]: value}});
    };

    for ( const input of panel.querySelectorAll("[name]") ) {
      this.#bindOnce(input, "change", event => save(event.target.name, event.target.value));
    }
  }

  /* -------------------------------------------- */

  /**
   * Let an owner set how far along the case is, straight from the header.
   *
   * Progress is the investigators' own judgement — nothing on the board computes it — so it reads
   * and writes like any other opinion they record. The number follows the slider live, but only
   * the released value is written, so dragging it does not spray updates at everyone else.
   */
  #bindProgress() {
    const slider = this.element.querySelector(".ib-progress-input");
    if ( !slider ) return;

    this.#bindOnce(slider, "input", () => {
      const readout = this.element.querySelector(".ib-progress-value");
      slider.style.setProperty("--ib-progress", `${slider.value}%`);
      if ( readout ) readout.textContent = `${slider.value}%`;
    });

    this.#bindOnce(slider, "change", async () => {
      const journal = this.currentCase;
      if ( !journal?.isOwner ) return;
      await journal.setFlag(MODULE_ID, CASE_FLAGS.PROGRESS, Number(slider.value));
    });
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
    // Cards are redrawn on every render, so both overlays have to be re-applied over them.
    this.#applyFilterToBoard();
    this.#paintPresence();

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
      onSelect: async clueId => {
        this.#selectedClue = clueId;
        await this.render({parts: ["inspector"]});
      },
      onEdit: page => ClueDialog.edit(page),
      onDismiss: page => dismissClue(page),
      onLink: (fromId, toId) => this.#linkClues(fromId, toId),
      onUnlink: connectionId => this.#unlinkClues(connectionId),
      onLinkModeChange: () => this.render({parts: ["toolbar"]}),
      onGrab: clueId => announce(clueId, this.#caseId)
    }).attach();

    // Someone else picking up or letting go of a card only changes a badge, never the layout.
    watchPresence(() => this.#paintPresence());
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
    // Let go of any card this user was holding, and stop the expiry sweeper: otherwise the
    // claims and their interval outlive the board across every open and close.
    announce(null, this.#caseId);
    clearPresence();
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
   * Start a new case file and open it.
   * @this {InvestigationBoard}
   * @returns {Promise<void>}
   */
  static async #onCreateCase() {
    const loc = key => game.i18n.localize(`INVESTIGATION_BOARD.${key}`);
    // Sharing is offered here because this is the only moment a player can set it: the server
    // permits a non-GM to set default ownership on creation, but not to change it afterwards.
    const result = await foundry.applications.api.DialogV2.prompt({
      window: {title: "INVESTIGATION_BOARD.NewCase"},
      content: `
        <div class="form-group">
          <label for="ib-new-case-name">${loc("CaseNameLabel")}</label>
          <div class="form-fields">
            <input type="text" id="ib-new-case-name" name="name" autofocus
                   placeholder="${loc("CaseNamePlaceholder")}">
          </div>
        </div>
        <div class="form-group">
          <label for="ib-new-case-visibility">${loc("VisibilityLabel")}</label>
          <div class="form-fields">
            <select id="ib-new-case-visibility" name="visibility">
              <option value="party">${loc("VISIBILITY.Party")}</option>
              <option value="partyRead">${loc("VISIBILITY.PartyRead")}</option>
              <option value="private">${loc("VISIBILITY.Private")}</option>
            </select>
          </div>
          <p class="hint">${loc("VisibilityHint")}</p>
        </div>`,
      ok: {
        label: "INVESTIGATION_BOARD.Create",
        icon: "fa-solid fa-folder-plus",
        callback: (_event, button) => ({
          name: button.form.elements.name.value.trim(),
          visibility: button.form.elements.visibility.value
        })
      },
      modal: true,
      rejectClose: false
    });
    if ( !result?.name ) return;

    const journal = await createCase(result);
    if ( journal ) await this.showCase(journal.id);
  }

  /* -------------------------------------------- */

  /**
   * Save the current case to a file.
   * @this {InvestigationBoard}
   */
  static #onExportCase() {
    const journal = this.currentCase;
    if ( !journal ) return;
    const data = exportCase(journal);
    foundry.utils.saveDataToFile(
      JSON.stringify(data, null, 2), "application/json", exportFilename(journal)
    );
    ui.notifications.info(game.i18n.format("INVESTIGATION_BOARD.NOTIFY.Exported",
      {count: data.clues.length}));
  }

  /* -------------------------------------------- */

  /**
   * Load a case from a file.
   * @this {InvestigationBoard}
   * @returns {Promise<void>}
   */
  static async #onImportCase() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";

    const file = await new Promise(resolve => {
      input.addEventListener("change", () => resolve(input.files?.[0] ?? null), {once: true});
      input.addEventListener("cancel", () => resolve(null), {once: true});
      input.click();
    });
    if ( !file ) return;

    let parsed;
    try {
      parsed = JSON.parse(await file.text());
    }
    catch {
      ui.notifications.error("INVESTIGATION_BOARD.NOTIFY.ImportNotJSON", {localize: true});
      return;
    }

    const check = validateExport(parsed);
    if ( !check.ok ) {
      ui.notifications.error(check.reason, {localize: true});
      return;
    }

    const {journal, pages} = buildImport(check.data, game.user.id);
    if ( !canCreateDirectly() ) {
      ui.notifications.error("INVESTIGATION_BOARD.NOTIFY.ImportNeedsPermission", {localize: true});
      return;
    }

    const created = await JournalEntry.create(journal);
    if ( !created ) return;
    await created.createEmbeddedDocuments("JournalEntryPage", pages, {keepId: true});
    await this.showCase(created.id);
    ui.notifications.info(game.i18n.format("INVESTIGATION_BOARD.NOTIFY.Imported",
      {name: created.name}));
  }

  /* -------------------------------------------- */

  /**
   * Choose who can work on a case.
   * @this {InvestigationBoard}
   * @param {PointerEvent} _event
   * @param {HTMLElement} target
   */
  static #onShareCase(_event, target) {
    const journal = game.journal.get(target.dataset.caseId ?? this.#caseId);
    if ( !journal ) return;
    if ( !canManageSharing(journal, game.user) ) {
      ui.notifications.warn("INVESTIGATION_BOARD.NOTIFY.NotYoursToShare", {localize: true});
      return;
    }
    ShareDialog.open(journal);
  }

  /* -------------------------------------------- */

  /**
   * Close a case, or reopen it. Players archive; only the GM deletes.
   * @this {InvestigationBoard}
   * @param {PointerEvent} _event
   * @param {HTMLElement} target
   * @returns {Promise<void>}
   */
  static async #onArchiveCase(_event, target) {
    const journal = game.journal.get(target.dataset.caseId ?? this.#caseId);
    if ( !journal?.isOwner ) {
      ui.notifications.warn("INVESTIGATION_BOARD.NOTIFY.NoPermission", {localize: true});
      return;
    }
    const nowArchived = !caseState(journal).archived;
    await archiveCase(journal, nowArchived);
    await this.render();
  }

  /* -------------------------------------------- */

  /**
   * Open the case's written record beside the board.
   * @this {InvestigationBoard}
   * @param {PointerEvent} _event
   * @param {HTMLElement} target
   */
  static #onOpenCaseFile(_event, target) {
    const caseId = target.dataset.caseId ?? this.#caseId;
    if ( caseId ) CaseFile.open(caseId);
  }

  /* -------------------------------------------- */

  /**
   * Destroy a case and everything on its board. GM only — players close a case instead.
   * @this {InvestigationBoard}
   * @param {PointerEvent} _event
   * @param {HTMLElement} target
   * @returns {Promise<void>}
   */
  static async #onDeleteCase(_event, target) {
    const journal = game.journal.get(target.dataset.caseId ?? this.#caseId);
    if ( !journal ) return;
    if ( !canDeleteCase(journal, game.user) ) {
      ui.notifications.warn("INVESTIGATION_BOARD.NOTIFY.CaseDeleteIsGMOnly", {localize: true});
      return;
    }

    // The clue count is the part a GM cannot see from the journal sidebar, where a case looks
    // like any other entry — so the confirmation says what actually goes with it.
    const clues = getClues(journal).length + getDismissed(journal).length;
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: {title: "INVESTIGATION_BOARD.DeleteCase"},
      content: `<p>${game.i18n.format("INVESTIGATION_BOARD.DeleteCaseConfirm",
        {name: journal.name, clues})}</p>`,
      modal: true
    });
    if ( !confirmed ) return;

    // The clue and connection pages are embedded, so they go with the entry; nothing to cascade.
    await journal.delete();
    this.#framed.delete(journal.id);
    this.#viewStates.delete(journal.id);
    if ( this.#caseId === journal.id ) this.#caseId = getCases()[0]?.id ?? null;
    await this.render();
  }

  /* -------------------------------------------- */

  /**
   * Open a case's details.
   * @this {InvestigationBoard}
   * @param {PointerEvent} _event
   * @param {HTMLElement} target
   */
  static #onConfigureCase(_event, target) {
    const journal = game.journal.get(target.dataset.caseId);
    if ( !journal?.isOwner ) {
      ui.notifications.warn("INVESTIGATION_BOARD.NOTIFY.NoPermission", {localize: true});
      return;
    }
    CaseConfig.open(journal);
  }

  /* -------------------------------------------- */


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
        ...authorStamp(),
        createdAt: Date.now(),
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
   * Put down whatever tool is in use and go back to the plain pointer.
   *
   * The linking tool deliberately stays on between links, and the filter popover sits over the
   * cork until it is dismissed — both are states you have to get *out* of, and Escape was the
   * only way. This is that way out, in the toolbar where the tools were picked up.
   *
   * What is selected is left alone: the inspector showing a clue is not a tool in use, and
   * clearing it here would mean losing the card you were reading to get your pointer back.
   * @this {InvestigationBoard}
   * @returns {Promise<void>}
   */
  static async #onUseHand() {
    // Dropping link mode also abandons any half-drawn string, and re-renders the toolbar.
    this.#interactions?.setLinkMode(false);
    if ( !this.#filterOpen ) return;
    this.#filterOpen = false;
    await this.render({parts: ["filter", "toolbar"]});
  }

  /* -------------------------------------------- */

  /**
   * Turn the linking tool on or off. It stays on between links, so several pairs can be tied
   * together in a row without going back to the toolbar.
   * @this {InvestigationBoard}
   */
  static #onDrawConnection() {
    if ( !this.#writableCase() ) return;
    this.#interactions?.setLinkMode();
  }

  /* -------------------------------------------- */

  /**
   * Open or close the filter popover.
   * @this {InvestigationBoard}
   */
  static async #onToggleFilter() {
    this.#filterOpen = !this.#filterOpen;
    await this.render({parts: ["filter", "toolbar"]});
  }

  /* -------------------------------------------- */

  /**
   * Drop the filter and bring the whole board back.
   * @this {InvestigationBoard}
   */
  static async #onClearFilter() {
    this.#filter = {...EMPTY_FILTER};
    this.#applyFilterToBoard();
    await this.render({parts: ["filter", "toolbar"]});
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
   * Start a string from the clue in the inspector.
   * @this {InvestigationBoard}
   */
  static #onLinkFromSelected() {
    if ( this.#selectedClue ) this.#interactions?.linkFrom(this.#selectedClue);
  }

  /* -------------------------------------------- */

  /**
   * Add a dated note to the selected clue — the running commentary a case accumulates.
   * @this {InvestigationBoard}
   * @returns {Promise<void>}
   */
  static async #onAddNote() {
    const page = this.currentCase?.pages.get(this.#selectedClue);
    if ( !page?.isOwner ) return;

    const text = await foundry.applications.api.DialogV2.prompt({
      window: {title: "INVESTIGATION_BOARD.AddNote"},
      content: `<div class="form-group stacked"><textarea name="note" rows="4" autofocus
                  placeholder="${game.i18n.localize("INVESTIGATION_BOARD.NotePlaceholder")}"></textarea></div>`,
      ok: {
        label: "INVESTIGATION_BOARD.AddNote",
        icon: "fa-solid fa-plus",
        callback: (_event, button) => button.form.elements.note.value.trim()
      },
      modal: true,
      rejectClose: false
    });
    if ( !text ) return;

    // Appended to a copy: writing the whole array back is how an ArrayField takes an addition.
    await page.update({
      system: {
        notes: [...page.system.notes, {author: game.user.id, text, time: Date.now()}]
      }
    });
    await this.render({parts: ["inspector"]});
  }

  /* -------------------------------------------- */

  /**
   * Open the document the selected clue was made from.
   * @this {InvestigationBoard}
   * @returns {Promise<void>}
   */
  static async #onOpenLinked() {
    const page = this.currentCase?.pages.get(this.#selectedClue);
    const uuid = page?.system.linkedUuid;
    if ( !uuid ) return;
    const document = await fromUuid(uuid);
    if ( !document ) {
      ui.notifications.warn("INVESTIGATION_BOARD.NOTIFY.LinkBroken", {localize: true});
      return;
    }
    document.sheet?.render({force: true});
  }

  /* -------------------------------------------- */

  /**
   * Highlight a string listed in the inspector, so it can be picked out among many.
   * @this {InvestigationBoard}
   * @param {PointerEvent} _event
   * @param {HTMLElement} target
   */
  static #onFocusConnection(_event, target) {
    this.#interactions?.selectString(target.dataset.connectionId);
  }

  /* -------------------------------------------- */

  /**
   * Cut a string from the inspector's list.
   * @this {InvestigationBoard}
   * @param {PointerEvent} _event
   * @param {HTMLElement} target
   * @returns {Promise<void>}
   */
  static async #onCutConnection(_event, target) {
    await this.#unlinkClues(target.dataset.connectionId);
    await this.render({parts: ["inspector"]});
  }

  /* -------------------------------------------- */

  /**
   * Tie two clues together with a string.
   * @param {string} fromId
   * @param {string} toId
   * @returns {Promise<void>}
   */
  async #linkClues(fromId, toId) {
    const journal = this.#writableCase();
    if ( !journal ) return;

    const check = canConnect(journal, fromId, toId);
    if ( !check.ok ) {
      ui.notifications.warn(check.reason, {localize: true});
      return;
    }

    const from = journal.pages.get(fromId);
    await journal.createEmbeddedDocuments("JournalEntryPage", [{
      name: game.i18n.format("INVESTIGATION_BOARD.ConnectionName", {
        from: from?.name ?? "?",
        to: journal.pages.get(toId)?.name ?? "?"
      }),
      type: PAGE_TYPES.CONNECTION,
      system: {
        from: fromId,
        to: toId,
        // The string takes the colour of the pin it starts from, so a line of enquiry reads
        // as one colour across the board.
        color: from?.system.pinColor ?? "red",
        style: "solid",
        label: ""
      }
    }]);
  }

  /* -------------------------------------------- */

  /**
   * Cut a string. The clues at either end are untouched — unlinking is not destructive, so it
   * needs no confirmation and is available to any owner.
   * @param {string} connectionId
   * @returns {Promise<void>}
   */
  async #unlinkClues(connectionId) {
    const journal = this.#writableCase();
    if ( !journal?.pages.get(connectionId) ) return;
    await journal.deleteEmbeddedDocuments("JournalEntryPage", [connectionId]);
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
