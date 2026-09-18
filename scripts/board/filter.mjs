import {getClues, getConnections} from "../data/case.mjs";

/**
 * Filtering the board.
 *
 * Non-matching clues are **dimmed, not hidden**. A board is a spatial memory — "the watch is
 * bottom-right, next to the map" — and removing cards would collapse the layout and destroy that.
 * Dimming keeps every card exactly where it was while pushing the matches forward.
 */

/** An empty filter: everything matches. */
export const EMPTY_FILTER = Object.freeze({
  text: "",
  category: "",
  reliability: "",
  author: ""
});

/**
 * Whether a filter would exclude anything at all.
 * @param {object} filter
 * @returns {boolean}
 */
export function isActive(filter) {
  return Object.values(filter ?? {}).some(v => String(v ?? "").trim().length > 0);
}

/* -------------------------------------------- */

/**
 * Whether a clue matches a filter.
 * @param {JournalEntryPage} page
 * @param {object} filter
 * @returns {boolean}
 */
export function matches(page, filter) {
  const clue = page.system;

  if ( filter.category && (clue.category !== filter.category) ) return false;
  if ( filter.reliability && (clue.reliability !== filter.reliability) ) return false;

  // "Author" means whoever last touched the clue, which is what a player actually looks for
  // when asking "what did Sam pin?".
  if ( filter.author && (page._stats?.lastModifiedBy !== filter.author) ) return false;

  const text = filter.text?.trim().toLowerCase();
  if ( text ) {
    // Body is HTML; strip the tags so a search for "clasp" is not thrown by <p> or a link.
    const body = String(clue.body ?? "").replace(/<[^>]*>/g, " ");
    const haystack = `${page.name} ${body}`.toLowerCase();
    if ( !haystack.includes(text) ) return false;
  }

  return true;
}

/* -------------------------------------------- */

/**
 * Work out what a filter leaves showing.
 *
 * A string is kept bright only when *both* its clues match, since a string to something filtered
 * out is a line to nowhere.
 *
 * @param {JournalEntry} journal
 * @param {object} filter
 * @returns {{clues: Set<string>, connections: Set<string>, total: number}}
 */
export function applyFilter(journal, filter) {
  const clues = getClues(journal);
  const matching = new Set(clues.filter(p => matches(p, filter)).map(p => p.id));
  const connections = new Set(
    getConnections(journal)
      .filter(c => matching.has(c.system.from) && matching.has(c.system.to))
      .map(c => c.id)
  );
  return {clues: matching, connections, total: clues.length};
}
