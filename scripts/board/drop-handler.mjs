import {CLUE_DEFAULTS, PAGE_TYPES} from "../constants.mjs";
import {handoutClueData, isHandout} from "../data/handouts.mjs";
import {freeSpotNear, topZ} from "../data/case.mjs";
import {authorStamp} from "../data/authorship.mjs";

/**
 * Turning something dropped on the cork into a clue.
 *
 * Dropping an Actor, Item or Journal page pins a clue that *points at* that document rather than
 * copying it: the clue carries a `linkedUuid`, so the board stays a view onto the world's real
 * contents and a renamed NPC does not leave a stale card behind.
 */

/**
 * How each droppable document type is turned into a card.
 * @type {Record<string, {template: string, category: string}>}
 */
const DROP_TEMPLATES = {
  Actor: {template: "mugshot", category: "person"},
  Item: {template: "polaroid", category: "physical"},
  JournalEntry: {template: "document", category: "document"},
  JournalEntryPage: {template: "document", category: "document"},
  Scene: {template: "map", category: "location"},
  RollTable: {template: "document", category: "document"}
};

/* -------------------------------------------- */

/**
 * Handles documents and images dropped onto the board.
 */
export default class DropHandler {

  /**
   * @param {object} config
   * @param {HTMLElement} config.viewport
   * @param {import("./board-view.mjs").default} config.view
   * @param {() => JournalEntry|null} config.getCase
   */
  constructor({viewport, view, getCase}) {
    this.viewport = viewport;
    this.view = view;
    this.getCase = getCase;
  }

  #listeners = [];

  /** Bind drop listeners. */
  attach() {
    this.#bind("dragover", this.#onDragOver.bind(this));
    this.#bind("dragleave", this.#onDragLeave.bind(this));
    this.#bind("drop", this.#onDrop.bind(this));
    return this;
  }

  /** Remove them again. */
  destroy() {
    for ( const [type, fn] of this.#listeners ) this.viewport.removeEventListener(type, fn);
    this.#listeners = [];
  }

  /* -------------------------------------------- */

  /** @param {DragEvent} event */
  #onDragOver(event) {
    // Only advertise a drop when there is actually somewhere to put it.
    if ( !this.getCase()?.isOwner ) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    this.viewport.classList.add("drop-target");
  }

  /** @param {DragEvent} event */
  #onDragLeave(event) {
    // Ignore the dragleave fired when moving between children of the viewport.
    if ( this.viewport.contains(event.relatedTarget) ) return;
    this.viewport.classList.remove("drop-target");
  }

  /* -------------------------------------------- */

  /** @param {DragEvent} event */
  async #onDrop(event) {
    this.viewport.classList.remove("drop-target");

    const journal = this.getCase();
    if ( !journal?.isOwner ) return;

    const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
    if ( !data?.uuid && !data?.type ) return;
    event.preventDefault();
    event.stopPropagation();

    const clue = await this.#clueFromDrop(data);
    if ( !clue ) return;

    // Drop the card where the pointer let go, not at the view's centre.
    const at = this.view.screenToBoard(event.clientX, event.clientY);
    const spot = freeSpotNear(journal, {x: at.x + 100, y: at.y + 90});

    await journal.createEmbeddedDocuments("JournalEntryPage", [{
      name: clue.name,
      type: PAGE_TYPES.CLUE,
      system: {
        ...clue.system,
        ...authorStamp(),
        createdAt: Date.now(),
        x: spot.x,
        y: spot.y,
        z: topZ(journal) + 1,
        width: CLUE_DEFAULTS.width,
        rotation: Math.round(((Math.random() * 8) - 4) * 10) / 10
      }
    }]);
  }

  /* -------------------------------------------- */

  /**
   * Build the clue data for something dropped on the board.
   * @param {{type?: string, uuid?: string}} data
   * @returns {Promise<{name: string, system: object}|null>}
   */
  async #clueFromDrop(data) {
    if ( !data.uuid ) return null;

    const document = await fromUuid(data.uuid);
    if ( !document ) {
      ui.notifications.warn("INVESTIGATION_BOARD.NOTIFY.DropUnresolved", {localize: true});
      return null;
    }

    // A handout dropped on the cork is the one page of ours that *should* become a card, so it is
    // recognised before the refusal below — whether the GM dragged the journal entry or a player
    // dragged the page itself out of the documents tab.
    const handout = this.#handoutFrom(document);
    if ( handout ) return handout;

    // Refuse to pin a case, or a clue, onto a board — that would nest the board inside itself.
    if ( document.documentName === "JournalEntryPage" ) {
      if ( Object.values(PAGE_TYPES).includes(document.type) ) {
        ui.notifications.warn("INVESTIGATION_BOARD.NOTIFY.DropIsClue", {localize: true});
        return null;
      }
    }

    const config = DROP_TEMPLATES[document.documentName] ?? {template: "document", category: "other"};
    const image = this.#imageFor(document);

    return {
      name: document.name ?? game.i18n.localize("INVESTIGATION_BOARD.UntitledClue"),
      system: {
        template: image ? config.template : "document",
        category: config.category,
        reliability: "unverified",
        pinColor: "red",
        image: image ?? null,
        body: "",
        linkedUuid: document.uuid
      }
    };
  }

  /* -------------------------------------------- */

  /**
   * Clue data for a handout, if that is what was dropped.
   *
   * Either the entry or its page may be what was dragged; both mean the same document.
   * @param {foundry.abstract.Document} document
   * @returns {{name: string, system: object}|null}
   */
  #handoutFrom(document) {
    const journal = (document.documentName === "JournalEntryPage") ? document.parent : document;
    return isHandout(journal) ? handoutClueData(journal) : null;
  }

  /* -------------------------------------------- */

  /**
   * The best image to show for a dropped document, if it has one.
   * @param {foundry.abstract.Document} document
   * @returns {string|null}
   */
  #imageFor(document) {
    const candidate = document.img
      ?? document.thumb
      ?? document.src
      ?? document.background?.src
      ?? null;
    // Foundry's generic placeholders say less than no picture at all.
    if ( !candidate || candidate.includes("icons/svg/mystery-man") ) return null;
    return candidate;
  }

  /* -------------------------------------------- */

  /** Register a listener and remember it for teardown. */
  #bind(type, fn) {
    this.viewport.addEventListener(type, fn);
    this.#listeners.push([type, fn]);
  }
}
