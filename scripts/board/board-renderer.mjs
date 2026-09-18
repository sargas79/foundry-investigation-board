import {getClues, getConnections} from "../data/case.mjs";
import {createClueElement, updateClueElement} from "./clue-element.mjs";
import StringLayer, {pinAnchor} from "./string-layer.mjs";

/**
 * Renders a case onto the board and keeps it in step with the documents.
 *
 * Updates are applied surgically rather than by re-rendering the board: a full re-render would
 * interrupt a drag in progress and throw away focus and selection, and every clue move by any
 * player is a document update. So a changed clue patches its own card and redraws only the strings
 * that touch it.
 */
export default class BoardRenderer {

  /**
   * @param {HTMLElement} clueLayer    The `.ib-clue-layer` element.
   * @param {SVGSVGElement} stringSvg  The `.ib-string-layer` element.
   */
  constructor(clueLayer, stringSvg) {
    this.clueLayer = clueLayer;
    this.strings = new StringLayer(stringSvg);
  }

  /**
   * The case currently rendered.
   * @type {JournalEntry|null}
   */
  #journal = null;

  /**
   * Card elements by clue page id.
   * @type {Map<string, HTMLElement>}
   */
  #cards = new Map();

  /**
   * Live positions for clues being dragged, which have not been written to their documents yet.
   * @type {Map<string, {x: number, y: number}>}
   */
  #ghosts = new Map();

  /**
   * Bumped whenever the board switches to a different case.
   *
   * Enriching clue bodies is asynchronous, so a render or an update can be suspended mid-flight
   * while the user switches cases. Anything that awaits captures this value first and checks it
   * again afterwards, and abandons its work if the board has moved on — otherwise cards from the
   * case that was open get appended to the one now showing.
   * @type {number}
   */
  #generation = 0;

  /** The case currently rendered. */
  get journal() {
    return this.#journal;
  }

  /** Card elements by clue id. */
  get cards() {
    return this.#cards;
  }

  /* -------------------------------------------- */
  /*  Rendering                                   */
  /* -------------------------------------------- */

  /**
   * Render a case from scratch, replacing whatever was shown before.
   * @param {JournalEntry|null} journal
   * @returns {Promise<void>}
   */
  async render(journal) {
    this.#journal = journal;
    this.#ghosts.clear();
    const generation = ++this.#generation;

    if ( !journal ) return this.clear();

    const clues = getClues(journal);
    const bodies = await this.#enrichAll(clues);
    // The board moved on to another case while bodies were being enriched.
    if ( generation !== this.#generation ) return;

    // Reuse cards that survive across the render so images don't flash when switching back.
    const keep = new Set(clues.map(p => p.id));
    for ( const [id, el] of this.#cards ) {
      if ( !keep.has(id) ) {
        el.remove();
        this.#cards.delete(id);
      }
    }

    for ( const page of clues ) {
      const existing = this.#cards.get(page.id);
      if ( existing ) updateClueElement(existing, page, bodies.get(page.id));
      else {
        const el = createClueElement(page, bodies.get(page.id));
        this.#cards.set(page.id, el);
        this.clueLayer.append(el);
      }
    }

    this.#renderConnections();
  }

  /* -------------------------------------------- */

  /** Draw every connection of the current case, dropping any that no longer apply. */
  #renderConnections() {
    const connections = getConnections(this.#journal);
    for ( const page of connections ) {
      const from = this.#anchorFor(page.system.from);
      const to = this.#anchorFor(page.system.to);
      if ( !from || !to ) continue;
      this.strings.draw(page.id, from, to, {
        color: page.system.color,
        style: page.system.style,
        label: page.system.label
      });
    }
    this.strings.prune(new Set(connections.map(p => p.id)));
  }

  /* -------------------------------------------- */

  /**
   * The anchor point for a clue, honouring an in-progress drag.
   * @param {string} clueId
   * @returns {{x: number, y: number}|null}
   */
  #anchorFor(clueId) {
    const page = this.#journal?.pages.get(clueId);
    if ( !page ) return null;
    const ghost = this.#ghosts.get(clueId);
    return pinAnchor({
      x: ghost?.x ?? page.system.x,
      y: ghost?.y ?? page.system.y,
      width: page.system.width,
      rotation: page.system.rotation
    });
  }

  /* -------------------------------------------- */

  /**
   * Enrich every clue body once, in parallel.
   * @param {JournalEntryPage[]} clues
   * @returns {Promise<Map<string, string>>}
   */
  async #enrichAll(clues) {
    const editor = foundry.applications.ux.TextEditor.implementation;
    const entries = await Promise.all(clues.map(async page => {
      const body = page.system.body;
      if ( !body ) return [page.id, ""];
      const enriched = await editor.enrichHTML(body, {relativeTo: page, secrets: page.isOwner});
      return [page.id, enriched];
    }));
    return new Map(entries);
  }

  /* -------------------------------------------- */
  /*  Incremental updates                         */
  /* -------------------------------------------- */

  /**
   * Add or update a single clue's card, then redraw the strings that touch it.
   * @param {JournalEntryPage} page
   * @returns {Promise<void>}
   */
  async upsertClue(page) {
    if ( page.parent !== this.#journal ) return;

    // A dismissed clue leaves the board, taking its strings with it.
    if ( page.system.dismissed || !page.visible ) return this.removeClue(page.id);

    const generation = this.#generation;
    const editor = foundry.applications.ux.TextEditor.implementation;
    const body = page.system.body
      ? await editor.enrichHTML(page.system.body, {relativeTo: page, secrets: page.isOwner})
      : "";
    // The board switched case, or this clue was removed, while the body was being enriched.
    if ( (generation !== this.#generation) || (page.parent !== this.#journal) ) return;

    let el = this.#cards.get(page.id);
    if ( el ) updateClueElement(el, page, body);
    else {
      el = createClueElement(page, body);
      this.#cards.set(page.id, el);
      this.clueLayer.append(el);
    }
    this.#renderConnections();
  }

  /* -------------------------------------------- */

  /**
   * Remove a clue's card and any string attached to it.
   * @param {string} clueId
   */
  removeClue(clueId) {
    this.#cards.get(clueId)?.remove();
    this.#cards.delete(clueId);
    this.#ghosts.delete(clueId);
    this.#renderConnections();
  }

  /* -------------------------------------------- */

  /**
   * Add or update one connection.
   * @param {JournalEntryPage} page
   */
  upsertConnection(page) {
    if ( page.parent !== this.#journal ) return;
    this.#renderConnections();
  }

  /**
   * Remove one connection's string.
   * @param {string} connectionId
   */
  removeConnection(connectionId) {
    this.strings.remove(connectionId);
  }

  /* -------------------------------------------- */
  /*  Drag support                                */
  /* -------------------------------------------- */

  /**
   * Move a card without touching its document, for the duration of a drag.
   *
   * The strings attached to it follow, so the board stays coherent while the pointer is down and
   * only one document update is written when it is released.
   *
   * @param {string} clueId
   * @param {number} x
   * @param {number} y
   */
  moveGhost(clueId, x, y) {
    const el = this.#cards.get(clueId);
    if ( !el ) return;
    this.#ghosts.set(clueId, {x, y});
    el.style.setProperty("--ib-x", `${x}px`);
    el.style.setProperty("--ib-y", `${y}px`);
    this.#renderConnections();
  }

  /**
   * Drop the live position for a clue once its document has caught up.
   * @param {string} clueId
   */
  clearGhost(clueId) {
    this.#ghosts.delete(clueId);
  }

  /* -------------------------------------------- */

  /** Remove everything from the board. */
  clear() {
    for ( const el of this.#cards.values() ) el.remove();
    this.#cards.clear();
    this.#ghosts.clear();
    this.strings.clear();
  }
}
