import {CASE_FLAGS, CASE_STATUSES, MODULE_ID, PAGE_TYPES} from "../constants.mjs";

/**
 * Helpers for treating a JournalEntry as an investigation case.
 *
 * A case is an ordinary JournalEntry flagged as one; its clues and connections are pages of this
 * module's sub-types. Keeping it a plain journal means ownership, folders, compendium export and
 * cross-client sync all come from core rather than being rebuilt here.
 */

/**
 * Whether a journal entry is an investigation case.
 * @param {JournalEntry} journal
 * @returns {boolean}
 */
export function isCase(journal) {
  return !!journal?.getFlag(MODULE_ID, CASE_FLAGS.IS_CASE);
}

/* -------------------------------------------- */

/**
 * Every case the current user is allowed to see.
 * @param {object} [options]
 * @param {boolean} [options.includeArchived=false]
 * @returns {JournalEntry[]}
 */
export function getCases({includeArchived = false} = {}) {
  return game.journal.filter(j => {
    if ( !isCase(j) || !j.visible ) return false;
    if ( !includeArchived && j.getFlag(MODULE_ID, CASE_FLAGS.ARCHIVED) ) return false;
    return true;
  });
}

/* -------------------------------------------- */

/**
 * The clue pages of a case.
 * @param {JournalEntry} journal
 * @param {object} [options]
 * @param {boolean} [options.dismissed=false]   Return dismissed clues instead of active ones.
 * @returns {JournalEntryPage[]}
 */
export function getClues(journal, {dismissed = false} = {}) {
  if ( !journal ) return [];
  return journal.pages.filter(p => {
    return (p.type === PAGE_TYPES.CLUE) && (!!p.system.dismissed === dismissed) && p.visible;
  });
}

/* -------------------------------------------- */

/**
 * The connection pages of a case.
 *
 * Connections whose clues are missing or dismissed are filtered out: a string with nothing at one
 * end must never be drawn, and this is the single place that rule lives.
 *
 * @param {JournalEntry} journal
 * @returns {JournalEntryPage[]}
 */
export function getConnections(journal) {
  if ( !journal ) return [];
  const live = new Set(getClues(journal).map(p => p.id));
  return journal.pages.filter(p => {
    if ( (p.type !== PAGE_TYPES.CONNECTION) || !p.visible ) return false;
    return live.has(p.system.from) && live.has(p.system.to);
  });
}

/* -------------------------------------------- */

/**
 * The connections attached to a given clue.
 * @param {JournalEntry} journal
 * @param {string} clueId
 * @returns {JournalEntryPage[]}
 */
export function getConnectionsFor(journal, clueId) {
  return getConnections(journal).filter(p => p.system.touches(clueId));
}

/* -------------------------------------------- */

/**
 * The bounding box of a case's clues, in board coordinates, for framing the view.
 * @param {JournalEntryPage[]} clues
 * @returns {{x: number, y: number, width: number, height: number}|null}
 */
export function clueBounds(clues) {
  if ( !clues.length ) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for ( const page of clues ) {
    const {x, y, width} = page.system;
    // Height isn't stored — cards size to their content — so approximate with a generous card.
    const height = 260;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y - 14);
    maxX = Math.max(maxX, x + width);
    maxY = Math.max(maxY, y + height);
  }
  return {x: minX, y: minY, width: maxX - minX, height: maxY - minY};
}

/* -------------------------------------------- */

/**
 * A free spot near the centre of the view for a newly pinned clue, nudged along a short spiral so
 * several clues added in a row don't land exactly on top of one another.
 * @param {JournalEntry} journal
 * @param {{x: number, y: number}} center
 * @returns {{x: number, y: number}}
 */
export function freeSpotNear(journal, center) {
  const taken = getClues(journal).map(p => ({x: p.system.x, y: p.system.y}));
  const occupied = ({x, y}) => taken.some(t => (Math.abs(t.x - x) < 40) && (Math.abs(t.y - y) < 40));

  let spot = {x: Math.round(center.x - 100), y: Math.round(center.y - 90)};
  for ( let i = 0; (i < 60) && occupied(spot); i++ ) {
    const angle = i * 0.9;
    spot = {
      x: Math.round(center.x - 100 + (Math.cos(angle) * 26 * Math.sqrt(i + 1))),
      y: Math.round(center.y - 90 + (Math.sin(angle) * 26 * Math.sqrt(i + 1)))
    };
  }
  return spot;
}

/* -------------------------------------------- */

/**
 * The highest z among a case's clues, so a grabbed card can be brought to the front.
 * @param {JournalEntry} journal
 * @returns {number}
 */
export function topZ(journal) {
  return getClues(journal).reduce((max, p) => Math.max(max, p.system.z ?? 0), 0);
}

/* -------------------------------------------- */

/**
 * Take a clue off the board and put it in the discarded tray.
 *
 * Dismissal is the only removal players get: the clue and its connections are all still there, so
 * a lead written off too early can be brought back with everything it was tied to intact. Only the
 * GM can destroy a clue outright.
 *
 * @param {JournalEntryPage} page
 * @returns {Promise<JournalEntryPage>}
 */
export function dismissClue(page) {
  return page.update({
    system: {
      dismissed: true,
      dismissedBy: game.user.id,
      dismissedAt: Date.now()
    }
  });
}

/* -------------------------------------------- */

/**
 * Put a dismissed clue back on the board, where it was and still tied to whatever it was tied to.
 * @param {JournalEntryPage} page
 * @returns {Promise<JournalEntryPage>}
 */
export function recoverClue(page) {
  return page.update({
    system: {
      dismissed: false,
      dismissedBy: null,
      dismissedAt: null
    }
  });
}

/* -------------------------------------------- */

/**
 * The clues in a case's discarded tray, most recently dismissed first.
 * @param {JournalEntry} journal
 * @returns {JournalEntryPage[]}
 */
export function getDismissed(journal) {
  return getClues(journal, {dismissed: true})
    .sort((a, b) => (b.system.dismissedAt ?? 0) - (a.system.dismissedAt ?? 0));
}

/* -------------------------------------------- */

/**
 * Read a case's board-level flags with sensible fallbacks.
 * @param {JournalEntry} journal
 * @returns {{status: string, statusLabel: string, progress: number, classification: string,
 *            assignedTo: string|null, archived: boolean}}
 */
export function caseState(journal) {
  const flag = key => journal?.getFlag(MODULE_ID, key);
  const status = flag(CASE_FLAGS.STATUS) ?? "active";
  return {
    status,
    statusLabel: CASE_STATUSES[status] ?? CASE_STATUSES.active,
    progress: Math.round(Math.clamp(flag(CASE_FLAGS.PROGRESS) ?? 0, 0, 100)),
    classification: flag(CASE_FLAGS.CLASSIFICATION) ?? "",
    assignedTo: flag(CASE_FLAGS.ASSIGNED_TO) ?? null,
    archived: !!flag(CASE_FLAGS.ARCHIVED)
  };
}
