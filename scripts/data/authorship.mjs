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
 * A stamp for whoever is acting now.
 * @param {User} [user]
 * @returns {{createdBy: string, createdByActor: string|null, createdByName: string}}
 */
export function authorStamp(user = game.user) {
  const actor = user.character ?? null;
  return {
    createdBy: user.id,
    createdByActor: actor?.uuid ?? null,
    createdByName: actor?.name ?? user.name
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
    if ( actor?.name ) return actor.name;
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
