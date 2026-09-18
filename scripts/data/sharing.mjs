import {CASE_FLAGS, MODULE_ID} from "../constants.mjs";
import {findActiveGM} from "./case-create.mjs";

/** The query a client sends to a GM's client to change who can see a case. */
export const SHARE_QUERY = `${MODULE_ID}.shareCase`;

/**
 * Sharing a case after it exists.
 *
 * Foundry's server refuses a non-GM any change to a document's `ownership` beyond their own entry,
 * so this is the one operation that genuinely cannot be done without a GM or Assistant GM online.
 * A player's request is relayed to a GM's client, which checks the asker actually owns the case
 * before applying it. Choosing "the whole party" when *creating* a case avoids needing this at
 * all — see `case-create.mjs`.
 */

/**
 * Whether this user can change ownership without help.
 * True for Assistant GMs too: `isGM` covers both roles and the server treats them alike.
 * @param {User} [user]
 * @returns {boolean}
 */
export function canShareDirectly(user = game.user) {
  return !!user.isGM;
}

/* -------------------------------------------- */

/**
 * Whether a user is allowed to decide who else sees a case.
 *
 * The GM always may. Otherwise it is the person the case belongs to — not merely anyone who has
 * been given access, or a case shared with the party could be re-shared by any of them.
 *
 * @param {JournalEntry} journal
 * @param {User} user
 * @returns {boolean}
 */
export function canManageSharing(journal, user) {
  if ( !journal ) return false;
  if ( user.isGM ) return true;
  const assigned = journal.getFlag(MODULE_ID, CASE_FLAGS.ASSIGNED_TO);
  // A case with nobody recorded as its owner falls back to whoever owns the document.
  if ( !assigned ) return journal.isOwner;
  return assigned === user.id;
}

/* -------------------------------------------- */

/**
 * Build the ownership map for a case shared with the given users.
 * @param {JournalEntry} journal
 * @param {object} options
 * @param {string[]} options.userIds        Players who should be able to work on it.
 * @param {boolean} [options.wholeParty]    Give everyone access, rather than named players.
 * @param {number} [options.level]          The level granted; Owner by default.
 * @returns {object}
 */
export function ownershipFor(journal, {userIds = [], wholeParty = false, level} = {}) {
  const levels = CONST.DOCUMENT_OWNERSHIP_LEVELS;
  const granted = level ?? levels.OWNER;
  const assigned = journal.getFlag(MODULE_ID, CASE_FLAGS.ASSIGNED_TO);

  const ownership = {default: wholeParty ? granted : levels.NONE};

  // The case's own player keeps it whatever else changes, so sharing can never orphan a case.
  if ( assigned ) ownership[assigned] = levels.OWNER;

  if ( !wholeParty ) {
    for ( const id of userIds ) ownership[id] = granted;
  }

  // Every GM keeps full access; they are the only ones who can repair sharing later.
  for ( const user of game.users ) {
    if ( user.isGM ) ownership[user.id] = levels.OWNER;
  }

  return ownership;
}

/* -------------------------------------------- */

/**
 * Change who can work on a case, relaying through a GM when necessary.
 * @param {JournalEntry} journal
 * @param {{userIds?: string[], wholeParty?: boolean, level?: number}} options
 * @returns {Promise<boolean>}   Whether the change was applied.
 */
export async function shareCase(journal, options) {
  if ( !canManageSharing(journal, game.user) ) {
    ui.notifications.warn("INVESTIGATION_BOARD.NOTIFY.NotYoursToShare", {localize: true});
    return false;
  }

  const ownership = ownershipFor(journal, options);

  if ( canShareDirectly() ) {
    await journal.update({ownership});
    return true;
  }

  const gm = findActiveGM();
  if ( !gm ) {
    ui.notifications.error("INVESTIGATION_BOARD.NOTIFY.NoGMForShare", {localize: true});
    return false;
  }

  const result = await gm.query(SHARE_QUERY, {caseUuid: journal.uuid, ...options});
  if ( result?.error ) {
    ui.notifications.error("INVESTIGATION_BOARD.NOTIFY.ShareFailed", {localize: true});
    return false;
  }
  return true;
}

/* -------------------------------------------- */

/**
 * Apply a sharing request on a GM's client.
 * @param {object} request
 * @param {string} request.caseUuid
 * @param {string[]} [request.userIds]
 * @param {boolean} [request.wholeParty]
 * @param {number} [request.level]
 * @param {User} [user]   The user who asked; supplied by Foundry's query machinery.
 * @returns {Promise<{ok: true}|{error: string}>}
 */
export async function handleShareQuery({caseUuid, userIds, wholeParty, level}, {user} = {}) {
  const journal = await fromUuid(caseUuid);
  if ( !journal ) return {error: "unknown-case"};

  // The asker must own the case; a relayed request must not become a way around that.
  if ( user && !canManageSharing(journal, user) ) return {error: "not-permitted"};

  const ids = Array.isArray(userIds) ? userIds.filter(id => game.users.has(id)) : [];
  await journal.update({
    ownership: ownershipFor(journal, {userIds: ids, wholeParty: !!wholeParty, level})
  });
  return {ok: true};
}

/* -------------------------------------------- */

/**
 * Who a case is currently shared with, for the share dialog.
 * @param {JournalEntry} journal
 * @returns {{wholeParty: boolean, userIds: Set<string>}}
 */
export function currentSharing(journal) {
  const levels = CONST.DOCUMENT_OWNERSHIP_LEVELS;
  const ownership = journal?.ownership ?? {};
  return {
    wholeParty: (ownership.default ?? levels.NONE) >= levels.OBSERVER,
    userIds: new Set(Object.entries(ownership)
      .filter(([id, lvl]) => (id !== "default") && (lvl >= levels.OBSERVER))
      .map(([id]) => id))
  };
}
