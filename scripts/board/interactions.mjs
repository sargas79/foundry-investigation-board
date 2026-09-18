import {topZ} from "../data/case.mjs";
import {capturePointer, releasePointer} from "./pointer-capture.mjs";

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
   */
  constructor({viewport, view, renderer, getCase, onSelect, onEdit}) {
    this.viewport = viewport;
    this.view = view;
    this.renderer = renderer;
    this.getCase = getCase;
    this.onSelect = onSelect ?? (() => {});
    this.onEdit = onEdit ?? (() => {});
  }

  /** Bound listeners, retained for teardown. */
  #listeners = [];

  /** The drag gesture in progress, or null. */
  #drag = null;

  /** The id of the currently selected clue. */
  #selected = null;

  /** The clue being edited in place, or null. */
  #editing = null;

  /** The id of the currently selected clue. */
  get selected() {
    return this.#selected;
  }

  /** Whether a card is currently being dragged. */
  get isDragging() {
    return !!this.#drag?.moved;
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
    this.#bind(this.viewport, "keydown", this.#onKeyDown.bind(this));
    return this;
  }

  /** Remove every listener and finish any gesture in flight, saving text already typed. */
  destroy() {
    this.#cancelDrag();
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
      // A press on bare cork clears the selection; BoardView handles the panning itself.
      if ( !event.target.closest(".ib-string-hit") ) this.select(null);
      return;
    }

    const clueId = card.dataset.clueId;
    const page = this.getCase()?.pages.get(clueId);
    if ( !page ) return;

    this.select(clueId);

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
    const drag = this.#drag;
    if ( !drag || (event.pointerId !== drag.pointerId) ) return;

    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;

    if ( !drag.moved ) {
      if ( Math.hypot(dx, dy) < BoardInteractions.DRAG_THRESHOLD ) return;
      drag.moved = true;
      drag.card.classList.add("dragging");
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
    const drag = this.#drag;
    if ( !drag || (event.pointerId !== drag.pointerId) ) return;
    // Clear the gesture before anything that could throw, so a failure can never strand the
    // controller mid-drag and block every later one.
    this.#drag = null;
    releasePointer(this.viewport, event.pointerId);
    drag.card.classList.remove("dragging");

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
    if ( drag.moved ) {
      drag.card.style.zIndex = String(this.getCase()?.pages.get(drag.clueId)?.system.z ?? 0);
      this.renderer.moveGhost(drag.clueId, drag.originX, drag.originY);
      this.renderer.clearGhost(drag.clueId);
    }
  }

  /* -------------------------------------------- */
  /*  Editing                                     */
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
    if ( event.key === "Escape" ) {
      if ( this.#drag ) {
        event.stopPropagation();
        this.#cancelDrag();
      }
      else if ( this.#selected ) this.select(null);
    }
  }

  /* -------------------------------------------- */

  /** Register a listener and remember it for teardown. */
  #bind(el, type, fn, opts) {
    el.addEventListener(type, fn, opts);
    this.#listeners.push([el, type, fn, opts]);
  }
}
