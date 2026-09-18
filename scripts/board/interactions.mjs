import {topZ} from "../data/case.mjs";
import {capturePointer, releasePointer} from "./pointer-capture.mjs";
import {pinAnchor} from "./string-layer.mjs";

/**
 * Pointer and keyboard handling for the clue cards on the board.
 *
 * Dragging is deliberately local: the card and its strings follow the pointer through the
 * renderer's ghost positions, and exactly one document update is written when the pointer is
 * released. Writing on every pointer-move would flood every other client with updates and make the
 * board unusable over a network.
 */
export default class BoardInteractions {

  /** How far the pointer must travel before a press counts as a drag rather than a click. */
  static DRAG_THRESHOLD = 4;

  /**
   * @param {object} config
   * @param {HTMLElement} config.viewport              The `.ib-board-viewport` element.
   * @param {import("./board-view.mjs").default} config.view
   * @param {import("./board-renderer.mjs").default} config.renderer
   * @param {() => JournalEntry|null} config.getCase   The case currently displayed.
   * @param {(clueId: string|null) => void} [config.onSelect]
   * @param {(page: JournalEntryPage) => void} [config.onEdit]
   * @param {(page: JournalEntryPage) => void} [config.onDismiss]
   * @param {(fromId: string, toId: string) => void} [config.onLink]
   * @param {(connectionId: string) => void} [config.onUnlink]
   * @param {(active: boolean) => void} [config.onLinkModeChange]
   * @param {(clueId: string|null) => void} [config.onGrab]   Told which clue is held, for presence.
   */
  constructor({viewport, view, renderer, getCase, onSelect, onEdit, onDismiss,
    onLink, onUnlink, onLinkModeChange, onGrab}) {
    this.viewport = viewport;
    this.view = view;
    this.renderer = renderer;
    this.getCase = getCase;
    this.onSelect = onSelect ?? (() => {});
    this.onEdit = onEdit ?? (() => {});
    this.onDismiss = onDismiss ?? (() => {});
    this.onLink = onLink ?? (() => {});
    this.onUnlink = onUnlink ?? (() => {});
    this.onLinkModeChange = onLinkModeChange ?? (() => {});
    this.onGrab = onGrab ?? (() => {});
  }

  /** Bound listeners, retained for teardown. */
  #listeners = [];

  /** The drag gesture in progress, or null. */
  #drag = null;

  /** The id of the currently selected clue. */
  #selected = null;

  /** The clue being edited in place, or null. */
  #editing = null;

  /** Whether the toolbar's linking tool is switched on. */
  #linkMode = false;

  /**
   * A link being drawn, or null.
   * `viaPin` distinguishes the drag-from-the-pin shortcut from the click-click tool: the shortcut
   * finishes on pointer-up, the tool on the next click.
   * @type {{fromId: string, viaPin: boolean, pointerId?: number}|null}
   */
  #linking = null;

  /** The id of the currently selected connection. */
  #selectedString = null;

  /** The id of the currently selected clue. */
  get selected() {
    return this.#selected;
  }

  /** Whether a card is currently being dragged. */
  get isDragging() {
    return !!this.#drag?.moved;
  }

  /** Whether the linking tool is on. */
  get linkMode() {
    return this.#linkMode;
  }

  /** Whether a string is part-drawn, waiting for its second clue. */
  get isLinking() {
    return !!this.#linking;
  }

  /** The id of the currently selected connection, if any. */
  get selectedString() {
    return this.#selectedString;
  }

  /* -------------------------------------------- */

  /**
   * Turn the linking tool on or off.
   * @param {boolean} [active]   Omit to toggle.
   */
  setLinkMode(active = !this.#linkMode) {
    this.#linkMode = active;
    if ( !active ) this.#cancelLink();
    this.viewport.classList.toggle("linking", active);
    this.onLinkModeChange(active);
  }

  /* -------------------------------------------- */

  /**
   * Start drawing a string from a clue, as the inspector's Link button does.
   * @param {string} clueId
   */
  linkFrom(clueId) {
    if ( !this.renderer.cards.has(clueId) ) return;
    this.#beginLink(clueId, false, -1);
  }

  /* -------------------------------------------- */

  /**
   * Select a connection, clearing any clue selection.
   * @param {string|null} connectionId
   */
  selectString(connectionId) {
    this.#selectedString = connectionId;
    this.renderer.strings.select(connectionId);
    if ( connectionId ) this.select(null);
  }

  /* -------------------------------------------- */
  /*  Lifecycle                                   */
  /* -------------------------------------------- */

  /** Bind listeners. */
  attach() {
    this.#bind(this.viewport, "pointerdown", this.#onPointerDown.bind(this));
    this.#bind(this.viewport, "pointermove", this.#onPointerMove.bind(this));
    this.#bind(this.viewport, "pointerup", this.#onPointerUp.bind(this));
    this.#bind(this.viewport, "pointercancel", this.#onPointerCancel.bind(this));
    this.#bind(this.viewport, "dblclick", this.#onDoubleClick.bind(this));
    this.#bind(this.viewport, "contextmenu", this.#onContextMenu.bind(this));
    this.#bind(this.viewport, "keydown", this.#onKeyDown.bind(this));
    return this;
  }

  /** Remove every listener and finish any gesture in flight, saving text already typed. */
  destroy() {
    this.#cancelDrag();
    this.#closeCardMenu();
    if ( this.#editing ) this.commitInlineEdit();
    for ( const [el, type, fn, opts] of this.#listeners ) el.removeEventListener(type, fn, opts);
    this.#listeners = [];
  }

  /* -------------------------------------------- */
  /*  Selection                                   */
  /* -------------------------------------------- */

  /**
   * Select a clue, or clear the selection with null.
   * @param {string|null} clueId
   */
  select(clueId) {
    if ( clueId === this.#selected ) return;
    this.#selected = clueId;
    for ( const [id, el] of this.renderer.cards ) el.classList.toggle("selected", id === clueId);
    this.onSelect(clueId);
  }

  /* -------------------------------------------- */
  /*  Dragging                                    */
  /* -------------------------------------------- */

  /** @param {PointerEvent} event */
  #onPointerDown(event) {
    if ( event.button !== 0 ) return;
    // Let an in-place edit keep the pointer, and never start a drag from a link inside a card.
    if ( event.target.closest("[contenteditable='true'], a") ) return;

    // Pressing anywhere else while editing saves the edit. Blur normally does this, but relying
    // on it alone loses the text whenever focus never landed on the card in the first place.
    if ( this.#editing ) this.commitInlineEdit();

    const card = event.target.closest(".ib-clue");
    if ( !card ) {
      const string = event.target.closest(".ib-string-hit");
      if ( string ) {
        // Selecting a string is how it gets cut, so it takes priority over panning.
        event.preventDefault();
        this.selectString(string.parentElement?.dataset.connectionId ?? null);
        return;
      }
      // A press on bare cork clears both selections and abandons a half-drawn string.
      this.select(null);
      this.selectString(null);
      if ( this.#linking ) this.#cancelLink();
      return;
    }

    const clueId = card.dataset.clueId;
    const page = this.getCase()?.pages.get(clueId);
    if ( !page ) return;

    // --- Linking ----------------------------------------------------------
    // Dragging from the pin links without entering the tool; the tool links by two clicks.
    const fromPin = !!event.target.closest(".ib-pin");
    if ( this.#linking ) {
      event.preventDefault();
      this.#completeLink(clueId);
      return;
    }
    if ( (this.#linkMode || fromPin) && page.isOwner ) {
      event.preventDefault();
      this.#beginLink(clueId, fromPin, event.pointerId);
      return;
    }

    this.select(clueId);
    this.selectString(null);

    // The link marker is the way back to whatever the clue was made from.
    if ( event.target.closest(".ib-clue-link") ) {
      event.preventDefault();
      this.#openLinked(page);
      return;
    }

    // Read-only players can select and inspect, but not move anything.
    if ( !page.isOwner ) return;

    this.#drag = {
      pointerId: event.pointerId,
      clueId,
      card,
      startX: event.clientX,
      startY: event.clientY,
      originX: page.system.x,
      originY: page.system.y,
      moved: false
    };
    capturePointer(this.viewport, event.pointerId);
    event.preventDefault();
  }

  /* -------------------------------------------- */

  /** @param {PointerEvent} event */
  #onPointerMove(event) {
    // A string being drawn follows the pointer wherever it goes.
    if ( this.#linking ) {
      const from = this.#anchorOf(this.#linking.fromId);
      const to = this.view.screenToBoard(event.clientX, event.clientY);
      if ( from ) this.renderer.strings.drawPending(from, to);
      return;
    }

    const drag = this.#drag;
    if ( !drag || (event.pointerId !== drag.pointerId) ) return;

    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;

    if ( !drag.moved ) {
      if ( Math.hypot(dx, dy) < BoardInteractions.DRAG_THRESHOLD ) return;
      drag.moved = true;
      drag.card.classList.add("dragging");
      this.onGrab(drag.clueId);
      // Bring the card to the front as soon as it actually moves. Applied locally now and
      // written with the position on release, so a nudge costs one update rather than two.
      drag.z = topZ(this.getCase()) + 1;
      drag.card.style.zIndex = String(drag.z);
    }

    // Screen pixels are scaled by the current zoom before becoming board units.
    const scale = this.view.transform.scale || 1;
    drag.x = Math.round(drag.originX + (dx / scale));
    drag.y = Math.round(drag.originY + (dy / scale));
    this.renderer.moveGhost(drag.clueId, drag.x, drag.y);
  }

  /* -------------------------------------------- */

  /** @param {PointerEvent} event */
  async #onPointerUp(event) {
    // A pin-drag finishes wherever it is released; the click-click tool waits for another click.
    const linking = this.#linking;
    if ( linking?.viaPin && (event.pointerId === linking.pointerId) ) {
      releasePointer(this.viewport, event.pointerId);
      const target = this.#clueAt(event.clientX, event.clientY, linking.fromId);
      if ( target ) this.#completeLink(target);
      else this.#cancelLink();
      return;
    }

    const drag = this.#drag;
    if ( !drag || (event.pointerId !== drag.pointerId) ) return;
    // Clear the gesture before anything that could throw, so a failure can never strand the
    // controller mid-drag and block every later one.
    this.#drag = null;
    releasePointer(this.viewport, event.pointerId);
    drag.card.classList.remove("dragging");
    if ( drag.moved ) this.onGrab(null);

    if ( !drag.moved ) return;

    const page = this.getCase()?.pages.get(drag.clueId);
    if ( !page ) return this.renderer.clearGhost(drag.clueId);

    // One update for the whole gesture.
    await page.update({system: {x: drag.x, y: drag.y, z: drag.z}});
    // The document now matches where the card already is, so the ghost can be dropped without
    // the card jumping.
    this.renderer.clearGhost(drag.clueId);
  }

  /* -------------------------------------------- */

  /** @param {PointerEvent} event */
  #onPointerCancel(event) {
    if ( this.#drag && (event.pointerId === this.#drag.pointerId) ) this.#cancelDrag();
  }

  /** Abandon a drag, snapping the card back to where its document says it is. */
  #cancelDrag() {
    const drag = this.#drag;
    if ( !drag ) return;
    this.#drag = null;
    releasePointer(this.viewport, drag.pointerId);
    drag.card.classList.remove("dragging");
    if ( drag.moved ) this.onGrab(null);
    if ( drag.moved ) {
      drag.card.style.zIndex = String(this.getCase()?.pages.get(drag.clueId)?.system.z ?? 0);
      this.renderer.moveGhost(drag.clueId, drag.originX, drag.originY);
      this.renderer.clearGhost(drag.clueId);
    }
  }

  /* -------------------------------------------- */
  /*  Linking                                     */
  /* -------------------------------------------- */

  /**
   * Start drawing a string from a clue.
   * @param {string} fromId
   * @param {boolean} viaPin      Started by dragging the pin rather than by the toolbar tool.
   * @param {number} pointerId
   */
  #beginLink(fromId, viaPin, pointerId) {
    this.#linking = {fromId, viaPin, pointerId};
    this.viewport.classList.add("linking");
    this.renderer.cards.get(fromId)?.classList.add("link-source");
    if ( viaPin ) capturePointer(this.viewport, pointerId);

    // Show the string immediately, anchored at the source, so the gesture reads before any move.
    const from = this.#anchorOf(fromId);
    if ( from ) this.renderer.strings.drawPending(from, from);
  }

  /* -------------------------------------------- */

  /**
   * Finish a string at the given clue.
   * @param {string} toId
   */
  #completeLink(toId) {
    const link = this.#linking;
    if ( !link ) return;
    const {fromId} = link;
    this.#cancelLink();
    if ( fromId === toId ) return;
    this.onLink(fromId, toId);
  }

  /* -------------------------------------------- */

  /** Abandon a half-drawn string. */
  #cancelLink() {
    if ( !this.#linking ) return;
    this.renderer.cards.get(this.#linking.fromId)?.classList.remove("link-source");
    if ( this.#linking.viaPin ) releasePointer(this.viewport, this.#linking.pointerId);
    this.#linking = null;
    this.renderer.strings.drawPending(null, null);
    // The toolbar tool stays on for linking several pairs in a row; the pin shortcut does not.
    if ( !this.#linkMode ) this.viewport.classList.remove("linking");
  }

  /* -------------------------------------------- */

  /**
   * The clue under a screen point, if any.
   *
   * Hit-tested against the cards' own rectangles rather than with `elementFromPoint`, which
   * answers null for anything outside the visible viewport and can be shadowed by whatever the
   * compositor has on top. The topmost card wins, matching what the user sees.
   *
   * @param {number} clientX
   * @param {number} clientY
   * @param {string} [exclude]   A clue to ignore, normally the one the string started from.
   * @returns {string|null}
   */
  #clueAt(clientX, clientY, exclude) {
    let best = null;
    let bestZ = -Infinity;
    for ( const [id, el] of this.renderer.cards ) {
      if ( id === exclude ) continue;
      const rect = el.getBoundingClientRect();
      const inside = (clientX >= rect.left) && (clientX <= rect.right)
        && (clientY >= rect.top) && (clientY <= rect.bottom);
      if ( !inside ) continue;
      const z = Number(el.style.zIndex) || 0;
      if ( z >= bestZ ) {
        bestZ = z;
        best = id;
      }
    }
    return best;
  }

  /* -------------------------------------------- */

  /**
   * Where a clue's string attaches, honouring a drag in progress.
   * @param {string} clueId
   * @returns {{x: number, y: number}|null}
   */
  #anchorOf(clueId) {
    const page = this.getCase()?.pages.get(clueId);
    if ( !page ) return null;
    return pinAnchor({
      x: page.system.x, y: page.system.y,
      width: page.system.width, rotation: page.system.rotation
    });
  }

  /* -------------------------------------------- */
  /*  Editing                                     */
  /* -------------------------------------------- */

  /**
   * Open the document a clue was made from.
   * @param {JournalEntryPage} page
   * @returns {Promise<void>}
   */
  async #openLinked(page) {
    const uuid = page.system.linkedUuid;
    if ( !uuid ) return;
    const document = await fromUuid(uuid);
    if ( !document ) {
      ui.notifications.warn("INVESTIGATION_BOARD.NOTIFY.LinkBroken", {localize: true});
      return;
    }
    document.sheet?.render({force: true});
  }

  /* -------------------------------------------- */

  /** @param {MouseEvent} event */
  #onDoubleClick(event) {
    const card = event.target.closest(".ib-clue");
    if ( !card ) return;
    const page = this.getCase()?.pages.get(card.dataset.clueId);
    if ( !page?.isOwner ) return;
    event.preventDefault();
    this.onEdit(page);
  }

  /* -------------------------------------------- */

  /**
   * Edit a clue's text directly on the card.
   *
   * Used for leads, which are meant to be jotted down without a dialog getting in the way. Enter
   * commits, Escape reverts, and clicking away commits.
   *
   * @param {string} clueId
   * @param {"title"|"body"} [field="title"]
   */
  beginInlineEdit(clueId, field = "title") {
    // Finish whatever was being edited rather than refusing: an edit whose blur never arrived
    // would otherwise block in-place editing for the rest of the session.
    if ( this.#editing ) this.commitInlineEdit();

    const card = this.renderer.cards.get(clueId);
    const page = this.getCase()?.pages.get(clueId);
    if ( !card || !page?.isOwner ) return;

    const target = card.querySelector(field === "body" ? ".ib-clue-body" : ".ib-clue-title");
    if ( !target ) return;

    // Edited as plain text, never as markup. The rendered body is *enriched* HTML, so writing
    // innerHTML back would save @UUID links already expanded into anchors, permanently losing
    // their document references. Rich editing belongs in the dialog.
    const original = target.textContent;
    const originalHTML = target.innerHTML;
    this.#editing = {clueId, field, target, original, originalHTML};

    target.hidden = false;
    target.contentEditable = "true";
    target.classList.add("editing");
    target.focus();

    // Put the caret at the end rather than wherever the click landed.
    const range = document.createRange();
    range.selectNodeContents(target);
    range.collapse(false);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);

    const finish = commit => this.#endInlineEdit(commit);
    target.addEventListener("blur", () => finish(true), {once: true});
    target.addEventListener("keydown", event => {
      // Shift+Enter keeps its usual meaning inside a body; plain Enter commits.
      if ( (event.key === "Enter") && !event.shiftKey ) {
        event.preventDefault();
        target.blur();
      }
      else if ( event.key === "Escape" ) {
        event.preventDefault();
        event.stopPropagation();
        finish(false);
      }
    });
  }

  /* -------------------------------------------- */

  /** Whether a clue's text is currently being edited on the card. */
  get isEditing() {
    return !!this.#editing;
  }

  /**
   * Save the in-place edit in progress, if any.
   *
   * Public because blur is not the only way an edit ends — clicking another card, switching case
   * or closing the board all have to be able to commit what has been typed.
   * @returns {Promise<void>}
   */
  commitInlineEdit() {
    return this.#endInlineEdit(true);
  }

  /** Abandon the in-place edit in progress, if any. */
  cancelInlineEdit() {
    return this.#endInlineEdit(false);
  }

  /* -------------------------------------------- */

  /**
   * Finish an in-place edit.
   * @param {boolean} commit   Whether to save the change or revert it.
   */
  async #endInlineEdit(commit) {
    const edit = this.#editing;
    if ( !edit ) return;
    this.#editing = null;

    const {clueId, field, target, original, originalHTML} = edit;
    target.contentEditable = "false";
    target.classList.remove("editing");

    const value = target.textContent.trim();
    if ( !commit || (value === original.trim()) ) {
      target.innerHTML = originalHTML;
      return;
    }

    const page = this.getCase()?.pages.get(clueId);
    if ( !page ) {
      target.innerHTML = originalHTML;
      return;
    }

    if ( field === "body" ) await page.update({system: {body: BoardInteractions.textToHTML(value)}});
    else {
      // A clue must have a name; an emptied title falls back rather than failing validation.
      await page.update({name: value || game.i18n.localize("INVESTIGATION_BOARD.UntitledClue")});
    }
  }

  /* -------------------------------------------- */

  /**
   * Turn typed plain text into the paragraphs stored in a clue body, escaping as it goes.
   * @param {string} text
   * @returns {string}
   */
  static textToHTML(text) {
    return text
      .split(/\n{2,}/)
      .map(block => block.trim())
      .filter(block => block.length)
      .map(block => `<p>${foundry.utils.escapeHTML(block).replaceAll("\n", "<br>")}</p>`)
      .join("");
  }

  /* -------------------------------------------- */
  /*  Keyboard                                    */
  /* -------------------------------------------- */

  /** @param {KeyboardEvent} event */
  #onKeyDown(event) {
    // Never intercept keys meant for text being typed on a card.
    if ( this.#editing || event.target.closest("[contenteditable='true'], input, textarea") ) return;

    if ( event.key === "Escape" ) {
      event.stopPropagation();
      // Unwind one step at a time, most transient first.
      if ( this.#linking ) this.#cancelLink();
      else if ( this.#drag ) this.#cancelDrag();
      else if ( this.#linkMode ) this.setLinkMode(false);
      else if ( this.#selectedString ) this.selectString(null);
      else if ( this.#selected ) this.select(null);
      return;
    }

    // Keyboard equivalents for the pointer gestures, so the board can be worked without a mouse.
    const card = event.target.closest?.(".ib-clue");
    if ( card ) {
      const page = this.getCase()?.pages.get(card.dataset.clueId);
      if ( (event.key === "Enter") || (event.key === " ") ) {
        event.preventDefault();
        this.select(card.dataset.clueId);
        if ( (event.key === "Enter") && page?.isOwner ) this.onEdit(page);
        return;
      }
      // "l" starts a string from the focused card; the next Enter on another card finishes it.
      if ( ((event.key === "l") || (event.key === "L")) && page?.isOwner ) {
        event.preventDefault();
        if ( this.#linking ) this.#completeLink(card.dataset.clueId);
        else this.linkFrom(card.dataset.clueId);
        return;
      }
    }

    if ( (event.key !== "Delete") && (event.key !== "Backspace") ) return;

    // Delete cuts a selected string outright — unlinking is not destructive, the clues remain.
    if ( this.#selectedString ) {
      event.preventDefault();
      const id = this.#selectedString;
      this.selectString(null);
      this.onUnlink(id);
      return;
    }

    // On a clue, Delete sets it aside; it never destroys it. Only the GM can do that, from the
    // discarded tray.
    if ( this.#selected ) {
      const page = this.getCase()?.pages.get(this.#selected);
      if ( !page?.isOwner ) return;
      event.preventDefault();
      this.onDismiss(page);
    }
  }

  /* -------------------------------------------- */

  /**
   * Offer the actions available on a card.
   * @param {MouseEvent} event
   */
  #onContextMenu(event) {
    // A string first: it sits under the cards, so a hit here means the pointer is on the twine.
    const string = event.target.closest(".ib-string-hit");
    if ( string ) {
      const connectionId = string.parentElement?.dataset.connectionId;
      if ( !connectionId ) return;
      event.preventDefault();
      this.selectString(connectionId);
      if ( !this.getCase()?.isOwner ) return;
      this.#showMenu(event.clientX, event.clientY, [{
        icon: "fa-solid fa-scissors",
        label: "INVESTIGATION_BOARD.CutString",
        run: () => {
          this.selectString(null);
          this.onUnlink(connectionId);
        }
      }]);
      return;
    }

    const card = event.target.closest(".ib-clue");
    if ( !card ) return;
    event.preventDefault();

    const page = this.getCase()?.pages.get(card.dataset.clueId);
    if ( !page ) return;
    this.select(page.id);
    if ( !page.isOwner ) return;

    this.#showCardMenu(event.clientX, event.clientY, page);
  }

  /* -------------------------------------------- */

  /**
   * Show a small menu at a screen position for a clue.
   *
   * Hand-rolled rather than using core's ContextMenu, which expects to own a list of elements up
   * front — the cards here come and go as the case changes.
   *
   * @param {number} x
   * @param {number} y
   * @param {JournalEntryPage} page
   */
  #showCardMenu(x, y, page) {
    const entries = [
      {icon: "fa-solid fa-pen", label: "INVESTIGATION_BOARD.EditClue", run: () => this.onEdit(page)},
      {icon: "fa-solid fa-i-cursor", label: "INVESTIGATION_BOARD.RenameInPlace",
        run: () => this.beginInlineEdit(page.id, "title")},
      {icon: "fa-solid fa-link-slash", label: "INVESTIGATION_BOARD.LinkFromHere",
        run: () => this.#beginLink(page.id, false, -1)},
      {icon: "fa-solid fa-box-archive", label: "INVESTIGATION_BOARD.Dismiss",
        run: () => this.onDismiss(page)}
    ];
    if ( page.system.linkedUuid ) {
      entries.splice(2, 0, {icon: "fa-solid fa-link", label: "INVESTIGATION_BOARD.OpenLinked",
        run: () => this.#openLinked(page)});
    }
    this.#showMenu(x, y, entries);
  }

  /* -------------------------------------------- */

  /**
   * Show a menu of actions at a screen position.
   * @param {number} x
   * @param {number} y
   * @param {Array<{icon: string, label: string, run: () => void}>} entries
   */
  #showMenu(x, y, entries) {
    this.#closeCardMenu();

    const menu = document.createElement("nav");
    menu.className = "ib-card-menu";
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;

    for ( const entry of entries ) {
      const button = document.createElement("button");
      button.type = "button";
      button.innerHTML = `<i class="${entry.icon}"></i><span>${game.i18n.localize(entry.label)}</span>`;
      button.addEventListener("click", () => {
        this.#closeCardMenu();
        entry.run();
      });
      menu.append(button);
    }

    document.body.append(menu);
    this.#menu = menu;

    // Keep the menu on screen when opened near an edge.
    const rect = menu.getBoundingClientRect();
    if ( rect.right > window.innerWidth ) menu.style.left = `${x - rect.width}px`;
    if ( rect.bottom > window.innerHeight ) menu.style.top = `${y - rect.height}px`;

    // Any press elsewhere, or Escape, closes it.
    const dismiss = event => {
      // Node#contains throws on a non-Node, which a synthetic event dispatched at window supplies.
      // Anything that is not inside the menu closes it.
      if ( (event.target instanceof Node) && menu.contains(event.target) ) return;
      this.#closeCardMenu();
    };
    this.#menuDismiss = dismiss;
    window.addEventListener("pointerdown", dismiss, {capture: true});
    window.addEventListener("keydown", this.#menuKeydown = e => {
      if ( e.key === "Escape" ) this.#closeCardMenu();
    }, {capture: true});
  }

  /** The open card menu, if any. */
  #menu = null;
  #menuDismiss = null;
  #menuKeydown = null;

  /** Close the card menu if one is open. */
  #closeCardMenu() {
    if ( !this.#menu ) return;
    this.#menu.remove();
    this.#menu = null;
    if ( this.#menuDismiss ) window.removeEventListener("pointerdown", this.#menuDismiss, {capture: true});
    if ( this.#menuKeydown ) window.removeEventListener("keydown", this.#menuKeydown, {capture: true});
    this.#menuDismiss = null;
    this.#menuKeydown = null;
  }

  /* -------------------------------------------- */

  /** Register a listener and remember it for teardown. */
  #bind(el, type, fn, opts) {
    el.addEventListener(type, fn, opts);
    this.#listeners.push([el, type, fn, opts]);
  }
}
