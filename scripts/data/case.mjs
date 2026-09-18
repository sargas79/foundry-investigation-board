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
 * The case's opening document, if it has been written.
 * @param {JournalEntry} journal
 * @returns {JournalEntryPage|undefined}
 */
export function getBrief(journal) {
  return journal?.pages.find(p => (p.type === PAGE_TYPES.REPORT) && (p.system.kind === "brief"));
}

/* -------------------------------------------- */

/**
 * The findings pages, oldest first, so the file reads in the order it was written.
 * @param {JournalEntry} journal
 * @returns {JournalEntryPage[]}
 */
export function getFindings(journal) {
  if ( !journal ) return [];
  return journal.pages
    .filter(p => (p.type === PAGE_TYPES.REPORT) && (p.system.kind === "entry") && p.visible)
    .sort((a, b) => (a.system.sort - b.system.sort)
      || ((a.system.createdAt ?? 0) - (b.system.createdAt ?? 0)));
}

/* -------------------------------------------- */

/**
 * Whether a user may write a given case-file page.
 *
 * The opening file is the official record, so it belongs to the GM and to whoever the case belongs
 * to. A findings page belongs to whoever wrote it — anyone can add to the file, nobody rewrites
 * someone else's account of it. The GM may edit anything.
 *
 * @param {JournalEntryPage} page
 * @param {User} user
 * @returns {boolean}
 */
export function canEditReport(page, user) {
  if ( !page || !user ) return false;
  if ( user.isGM ) return true;
  if ( !page.parent?.isOwner ) return false;
  if ( page.system.kind === "brief" ) {
    const assigned = page.parent.getFlag(MODULE_ID, CASE_FLAGS.ASSIGNED_TO);
    return assigned ? (assigned === user.id) : true;
  }
  return page.system.author === user.id;
}

/* -------------------------------------------- */

/**
 * Close a case, moving it to the archived group.
 *
 * Archiving is to a case what dismissing is to a clue: the player's way of setting something
 * aside without destroying it. Only a GM can delete a case outright.
 *
 * @param {JournalEntry} journal
 * @param {boolean} [archived=true]
 * @returns {Promise<JournalEntry>}
 */
export function archiveCase(journal, archived = true) {
  return journal.setFlag(MODULE_ID, CASE_FLAGS.ARCHIVED, archived);
}

/* -------------------------------------------- */

/**
 * Whether a user may permanently delete a case.
 *
 * Owner is enough for Foundry (`delete: "OWNER"` on the JournalEntry), which is exactly why this
 * guard exists: players archive, the GM deletes.
 *
 * @param {JournalEntry} journal
 * @param {User} user
 * @returns {boolean}
 */
export function canDeleteCase(journal, user) {
  if ( !isCase(journal) ) return true;
  return !!user?.isGM;
}

/* -------------------------------------------- */

/**
 * The connection joining two clues, if there is one.
 *
 * A string has no direction — A tied to B is the same as B tied to A — so this matches either way
 * round. Used to stop the same pair being linked twice.
 *
 * @param {JournalEntry} journal
 * @param {string} a
 * @param {string} b
 * @returns {JournalEntryPage|undefined}
 */
export function findConnection(journal, a, b) {
  return journal?.pages.find(p => {
    if ( p.type !== PAGE_TYPES.CONNECTION ) return false;
    const {from, to} = p.system;
    return ((from === a) && (to === b)) || ((from === b) && (to === a));
  });
}

/* -------------------------------------------- */

/**
 * Whether two clues can be tied together.
 * @param {JournalEntry} journal
 * @param {string} a
 * @param {string} b
 * @returns {{ok: boolean, reason?: string}}
 */
export function canConnect(journal, a, b) {
  if ( !a || !b ) return {ok: false, reason: "INVESTIGATION_BOARD.NOTIFY.LinkIncomplete"};
  if ( a === b ) return {ok: false, reason: "INVESTIGATION_BOARD.NOTIFY.LinkToSelf"};
  if ( findConnection(journal, a, b) ) return {ok: false, reason: "INVESTIGATION_BOARD.NOTIFY.LinkExists"};
  return {ok: true};
}

/* -------------------------------------------- */

/**
 * Whether a user may permanently destroy a page of this module's.
 *
 * Only the GM may destroy a clue; players set clues aside instead, which keeps the clue and its
 * connections recoverable. Connections are deliberately unguarded — unlinking two clues is an
 * ordinary player action.
 *
 * @param {JournalEntryPage} page
 * @param {User} user
 * @returns {boolean}
 */
export function canDeletePage(page, user) {
  if ( page?.type !== PAGE_TYPES.CLUE ) return true;
  return !!user?.isGM;
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
