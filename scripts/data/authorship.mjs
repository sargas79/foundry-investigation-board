/**
 * Who made a thing, recorded so a board can be traced back.
 *
 * The name shown is the **character's**, not the account's: at the table people are Mara and
 * Silas, not diego and sam. A user with no character assigned — normally the GM — falls back to
 * their account name.
 *
 * Both a reference and a snapshot are kept. The uuid lets a rename follow through; the snapshot
 * keeps the attribution honest when the actor is later reassigned to a different player or deleted
 * outright. A campaign outlives its characters, and a player swapping character mid-way should not
 * silently rewrite who found the broken watch.
 */

/**
 * The name to show for a character.
 *
 * The prototype token's name, not the actor's. They are the same string for most actors — Foundry
 * seeds the token name from the actor name on creation — so this only differs where the GM has
 * deliberately set a short one, which is exactly the case worth honouring: the sheet says
 * "Bartholomew Ashworth III" and the table says "Bart", and a byline on a 180px lead has room for
 * one of those.
 *
 * @param {Actor|null} actor
 * @returns {string}
 */
export function characterName(actor) {
  if ( !actor ) return "";
  return actor.prototypeToken?.name || actor.name || "";
}

/* -------------------------------------------- */

/**
 * A stamp for whoever is acting now.
 * @param {User} [user]
 * @returns {{createdBy: string, createdByActor: string|null, createdByName: string}}
 */
export function authorStamp(user = game.user) {
  const actor = user.character ?? null;
  return {
    createdBy: user.id,
    createdByActor: actor?.uuid ?? null,
    createdByName: characterName(actor) || user.name
  };
}

/* -------------------------------------------- */

/**
 * The name to show for a stamp.
 *
 * Prefers the actor as it stands now, so a rename is reflected; falls back to the name recorded at
 * the time, then to the account, then to nothing recorded at all — clues pinned before any of this
 * existed carry no stamp and must read cleanly.
 *
 * @param {{createdBy?: string, createdByActor?: string|null, createdByName?: string}} stamp
 * @returns {string|null}
 */
export function authorName(stamp) {
  if ( !stamp ) return null;

  if ( stamp.createdByActor ) {
    // Synchronous on purpose: this is called while building render context for every card.
    const actor = fromUuidSync?.(stamp.createdByActor);
    const name = characterName(actor);
    if ( name ) return name;
  }
  if ( stamp.createdByName ) return stamp.createdByName;

  const user = stamp.createdBy ? game.users.get(stamp.createdBy) : null;
  return user?.name ?? null;
}

/* -------------------------------------------- */

/**
 * The colour of the player behind a stamp, for a dot beside the name.
 * @param {{createdBy?: string}} stamp
 * @returns {string|null}
 */
export function authorColor(stamp) {
  const user = stamp?.createdBy ? game.users.get(stamp.createdBy) : null;
  if ( !user ) return null;
  return user.color?.css ?? user.color ?? null;
}

/* -------------------------------------------- */
/*  Reassignment (#63)                          */
/* -------------------------------------------- */

/**
 * The fields that say who made a clue. Only a GM may change any of them once the clue exists.
 * @type {string[]}
 */
export const AUTHOR_FIELDS = ["createdBy", "createdByActor", "createdByName", "authorHistory"];

/**
 * Whether a user may change who a clue is credited to.
 *
 * The GM's alone. The stamp is only worth anything if the people it names cannot rewrite it, but a
 * campaign outlives its characters — one is retired, a player swaps to another, an actor is deleted
 * in a tidy-up — and someone has to be able to put the credit right.
 *
 * @param {User} user
 * @returns {boolean}
 */
export function canReassignAuthor(user) {
  return !!user?.isGM;
}

/* -------------------------------------------- */

/**
 * Whether an update would change who a page is credited to.
 *
 * Compared against what is stored rather than by the keys' mere presence, so a write that carries
 * the stamp through unchanged is not mistaken for an attempt on it.
 *
 * @param {object} current   The page's system data as it stands.
 * @param {object} changes   The update's system changes.
 * @returns {boolean}
 */
export function changesAuthor(current, changes) {
  if ( !changes ) return false;
  return AUTHOR_FIELDS.some(field => {
    if ( !(field in changes) ) return false;
    const before = current?.[field] ?? null;
    const after = changes[field] ?? null;
    if ( typeof before === "object" || typeof after === "object" ) {
      return JSON.stringify(before) !== JSON.stringify(after);
    }
    return before !== after;
  });
}

/* -------------------------------------------- */

/**
 * The player behind a character: whoever has it as their assigned character, failing that the
 * first player who owns it. A GM is never it — they own every actor.
 * @param {Actor} actor
 * @param {Iterable<User>} [users]
 * @returns {User|null}
 */
export function playerFor(actor, users = game.users) {
  if ( !actor ) return null;
  const players = [...users].filter(u => !u.isGM);
  return players.find(u => u.character?.uuid === actor.uuid)
    ?? players.find(u => actor.testUserPermission?.(u, "OWNER"))
    ?? null;
}

/* -------------------------------------------- */

/**
 * The system update that credits a page to another character.
 *
 * The new stamp replaces the old one outright — no reference to the previous actor survives in it,
 * which matters when that actor has been deleted. What the credit used to say is kept as a name in
 * `authorHistory`, alongside the GM who changed it and when, so a reassignment is never silent.
 *
 * @param {object} stamp                The page's system data as it stands.
 * @param {Actor} actor                 The character to credit.
 * @param {object} [options]
 * @param {User} [options.by]           The GM making the change.
 * @param {number} [options.time]
 * @param {Iterable<User>} [options.users]
 * @returns {{createdBy: string|null, createdByActor: string, createdByName: string,
 *            authorHistory: object[]}}
 */
export function reassignedStamp(stamp, actor, {by = game.user, time = Date.now(), users = game.users} = {}) {
  const toName = characterName(actor);
  return {
    createdBy: playerFor(actor, users)?.id ?? null,
    createdByActor: actor.uuid,
    createdByName: toName,
    authorHistory: [
      ...(stamp?.authorHistory ?? []),
      {fromName: authorName(stamp) ?? "", toName, by: by?.id ?? null, time}
    ]
  };
}

/* -------------------------------------------- */

/**
 * Credit a clue to another character.
 *
 * Refused unless the user is a GM and the character exists as an actor in this world. A refusal
 * leaves the clue exactly as it was.
 *
 * @param {JournalEntryPage} page
 * @param {string} actorUuid
 * @param {User} [user]
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
export async function reassignAuthor(page, actorUuid, user = game.user) {
  if ( !canReassignAuthor(user) ) return {ok: false, reason: "INVESTIGATION_BOARD.NOTIFY.ReassignIsGMOnly"};
  const actor = actorUuid ? await fromUuid(actorUuid) : null;
  if ( actor?.documentName !== "Actor" ) {
    return {ok: false, reason: "INVESTIGATION_BOARD.NOTIFY.ReassignNoCharacter"};
  }
  if ( page.system.createdByActor === actor.uuid ) {
    return {ok: false, reason: "INVESTIGATION_BOARD.NOTIFY.ReassignUnchanged"};
  }
  await page.update({system: reassignedStamp(page.system, actor, {by: user})});
  return {ok: true};
}
