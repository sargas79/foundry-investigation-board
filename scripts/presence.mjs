import {MODULE_ID} from "./constants.mjs";

/** The socket message telling others which clue someone has hold of. */
export const PRESENCE_EVENT = "presence";

/** How long a presence claim stands without being renewed. */
const TIMEOUT = 4000;

/**
 * Showing who else has hold of a clue.
 *
 * Sent over the module socket rather than written to the document: it is momentary, worthless a
 * second later, and writing it would put a database round-trip in the middle of every drag. A
 * claim expires on its own, so a player who disconnects mid-drag does not leave a card looking
 * permanently taken.
 */

/**
 * Live claims by clue id.
 * @type {Map<string, {userId: string, name: string, color: string, expires: number}>}
 */
const claims = new Map();

/** Called whenever the claims change, so the board can redraw its badges. */
let onChange = () => {};

/** Sweeps expired claims. */
let timer = null;

/* -------------------------------------------- */

/**
 * Listen for presence changes.
 * @param {() => void} callback
 */
export function watchPresence(callback) {
  onChange = callback;
}

/* -------------------------------------------- */

/**
 * Announce that this user has hold of a clue, or has let go.
 * @param {string|null} clueId   The clue taken, or null when released.
 * @param {string} caseId
 */
export function announce(clueId, caseId) {
  game.socket.emit(`module.${MODULE_ID}`, {
    type: PRESENCE_EVENT,
    caseId,
    clueId,
    userId: game.user.id,
    name: game.user.name,
    color: game.user.color?.css ?? game.user.color ?? "#ffffff"
  });
}

/* -------------------------------------------- */

/**
 * Apply a presence message from another client.
 * @param {object} message
 */
export function receivePresence(message) {
  if ( message?.type !== PRESENCE_EVENT ) return;
  if ( message.userId === game.user.id ) return;

  // A user can only hold one clue, so drop whatever they held before.
  for ( const [clueId, claim] of claims ) {
    if ( claim.userId === message.userId ) claims.delete(clueId);
  }

  if ( message.clueId ) {
    claims.set(message.clueId, {
      userId: message.userId,
      name: message.name,
      color: message.color,
      expires: Date.now() + TIMEOUT
    });
  }

  ensureSweeper();
  onChange();
}

/* -------------------------------------------- */

/**
 * Who has hold of a clue, if anyone.
 * @param {string} clueId
 * @returns {{userId: string, name: string, color: string}|null}
 */
export function holderOf(clueId) {
  const claim = claims.get(clueId);
  if ( !claim ) return null;
  if ( claim.expires <= Date.now() ) {
    claims.delete(clueId);
    return null;
  }
  return claim;
}

/** Forget every claim and stop the sweeper, when the board closes. */
export function clearPresence() {
  claims.clear();
  if ( timer ) {
    clearInterval(timer);
    timer = null;
  }
}

/* -------------------------------------------- */

/** Run a sweeper while there is anything to expire, and stop when there is not. */
function ensureSweeper() {
  if ( timer || !claims.size ) return;
  timer = setInterval(() => {
    const now = Date.now();
    let changed = false;
    for ( const [clueId, claim] of claims ) {
      if ( claim.expires <= now ) {
        claims.delete(clueId);
        changed = true;
      }
    }
    if ( changed ) onChange();
    if ( !claims.size ) {
      clearInterval(timer);
      timer = null;
    }
  }, 1000);
}
