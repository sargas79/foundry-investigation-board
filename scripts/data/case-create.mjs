import {CASE_FLAGS, MODULE_ID} from "../constants.mjs";

/** The query a player's client sends to a GM's client to have a case made for them. */
export const CREATE_CASE_QUERY = `${MODULE_ID}.createCase`;

/**
 * Creating a case file.
 *
 * `JOURNAL_CREATE` defaults to the Trusted Player role, so an ordinary Player cannot make a
 * JournalEntry themselves. Rather than demanding every table promote its players, a player's
 * client asks a connected GM to make the case and hand it straight back to them. Once it exists
 * they own it outright and need nobody online to work on it.
 */

/**
 * Build the data for a new case.
 * @param {object} options
 * @param {string} options.name
 * @param {string} [options.classification]
 * @param {string} options.ownerId   The user the case belongs to.
 * @returns {object}
 */
export function caseData({name, classification = "", ownerId}) {
  return {
    name,
    ownership: {
      default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE,
      [ownerId]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER
    },
    flags: {
      [MODULE_ID]: {
        [CASE_FLAGS.IS_CASE]: true,
        [CASE_FLAGS.STATUS]: "active",
        [CASE_FLAGS.PROGRESS]: 0,
        [CASE_FLAGS.CLASSIFICATION]: classification,
        [CASE_FLAGS.ASSIGNED_TO]: ownerId,
        [CASE_FLAGS.ARCHIVED]: false
      }
    }
  };
}

/* -------------------------------------------- */

/**
 * Whether this user can make a case without help.
 * @param {User} [user]
 * @returns {boolean}
 */
export function canCreateDirectly(user = game.user) {
  return user.can("JOURNAL_CREATE");
}

/* -------------------------------------------- */

/**
 * A GM who can act on a player's behalf, if one is connected.
 *
 * Assistant GMs count: `isGM` is true for both roles, and the server treats them the same for
 * ownership changes.
 *
 * @returns {User|undefined}
 */
export function findActiveGM() {
  return game.users.find(u => u.active && u.isGM);
}

/* -------------------------------------------- */

/**
 * Create a case, relaying through a GM if this user is not allowed to create journals.
 * @param {object} options
 * @param {string} options.name
 * @param {string} [options.classification]
 * @returns {Promise<JournalEntry|null>}
 */
export async function createCase({name, classification = ""}) {
  const data = caseData({name, classification, ownerId: game.user.id});

  if ( canCreateDirectly() ) return JournalEntry.create(data);

  const gm = findActiveGM();
  if ( !gm ) {
    ui.notifications.error("INVESTIGATION_BOARD.NOTIFY.NoGMForCreate", {localize: true});
    return null;
  }

  const result = await gm.query(CREATE_CASE_QUERY, {name, classification, ownerId: game.user.id});
  if ( !result?.uuid ) {
    ui.notifications.error("INVESTIGATION_BOARD.NOTIFY.CreateFailed", {localize: true});
    return null;
  }
  return fromUuid(result.uuid);
}

/* -------------------------------------------- */

/**
 * Handle a player's request to have a case created. Runs on a GM's client.
 * @param {{name: string, classification: string, ownerId: string}} request
 * @returns {Promise<{uuid: string}|{error: string}>}
 */
export async function handleCreateCaseQuery({name, classification, ownerId}) {
  // The asking player is the only one this may be created for, and the name is theirs to choose,
  // but it still has to be a real user and a usable name.
  const owner = game.users.get(ownerId);
  if ( !owner ) return {error: "unknown-user"};

  const journal = await JournalEntry.create(caseData({
    name: String(name ?? "").trim().slice(0, 200) || game.i18n.localize("INVESTIGATION_BOARD.UntitledCase"),
    classification: String(classification ?? "").trim().slice(0, 100),
    ownerId
  }));
  return journal ? {uuid: journal.uuid} : {error: "create-failed"};
}
