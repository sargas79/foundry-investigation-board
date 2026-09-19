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
