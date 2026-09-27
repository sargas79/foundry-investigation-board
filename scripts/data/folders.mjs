import {CASE_FLAGS, FOLDER_FLAGS, HANDOUT_FLAGS, MODULE_ID, SETTINGS} from "../constants.mjs";

/**
 * #80: the module's journals live in a folder of their own.
 *
 * Every case, handout and sealed companion entry is a JournalEntry, and left at the root of the
 * journal directory they bury the GM's own journals. They are filed in one "Cases" folder instead.
 *
 * The folder is found by a flag, not by its name, so the GM can rename it — or translate it — without
 * a second one being made beside it.
 *
 * Only an Assistant GM or above may create a Folder, but anyone who may create a journal may file it
 * in one that exists. So a GM's client makes the folder when the world starts, and a player creating
 * a case directly uses it if it is there. If it is not — the GM deleted it mid-session — the case is
 * made at the root rather than not at all: where a case is filed is never worth failing its creation.
 *
 * @module investigation-board/folders
 */

/**
 * The module's journal folder, if the world has one.
 * @param {Iterable<Folder>} [folders]
 * @returns {Folder|null}
 */
export function findCasesFolder(folders = game.folders) {
  if ( !folders ) return null;
  for ( const folder of folders ) {
    if ( (folder.type === "JournalEntry") && folder.getFlag(MODULE_ID, FOLDER_FLAGS.CASES) ) return folder;
  }
  return null;
}

/**
 * Whether the GM wants the module's journals filed in a folder.
 * @returns {boolean}
 */
export function usesCasesFolder() {
  return game.settings?.get(MODULE_ID, SETTINGS.CASES_FOLDER) ?? false;
}

/**
 * The data for a new folder.
 * @returns {object}
 */
export function casesFolderData() {
  return {
    name: game.i18n.localize("INVESTIGATION_BOARD.CasesFolderName"),
    type: "JournalEntry",
    sorting: "a",
    flags: {[MODULE_ID]: {[FOLDER_FLAGS.CASES]: true}}
  };
}

/**
 * The folder being created, so two journals created at once do not make a folder each.
 * @type {Promise<Folder|null>|null}
 */
let pending = null;

/**
 * Find the folder, creating it if this user is allowed to.
 * @returns {Promise<Folder|null>}
 */
export async function ensureCasesFolder() {
  const existing = findCasesFolder();
  if ( existing ) return existing;
  const cls = getDocumentClass("Folder");
  if ( !cls.canUserCreate(game.user) ) return null;
  pending ??= cls.create(casesFolderData()).finally(() => pending = null);
  return pending;
}

/**
 * The id of the folder a new module journal goes in, or null for the directory's root.
 *
 * Never throws: a folder that cannot be found or made leaves the journal at the root.
 * @returns {Promise<string|null>}
 */
export async function casesFolderId() {
  if ( !usesCasesFolder() ) return null;
  try {
    return (await ensureCasesFolder())?.id ?? null;
  }
  catch (error) {
    console.warn(`${MODULE_ID} | the cases folder could not be prepared`, error);
    return null;
  }
}

/**
 * Journal data, filed in the module's folder.
 * @param {object} data
 * @returns {Promise<object>}
 */
export async function inCasesFolder(data) {
  return {...data, folder: await casesFolderId()};
}

/* -------------------------------------------- */

/**
 * Whether a journal is one the module made: a case, a handout, or a case's sealed companion.
 * @param {object} source   The journal's `_source`.
 * @returns {boolean}
 */
export function isModuleJournal(source) {
  const flags = source.flags?.[MODULE_ID] ?? {};
  return !!(flags[CASE_FLAGS.IS_CASE] || flags[HANDOUT_FLAGS.IS_HANDOUT] || flags[CASE_FLAGS.SEALED_FOR]);
}

/**
 * The module journals a world made before the folder existed: those still at the directory's root.
 * One the GM has already filed somewhere is left where they put it.
 * @param {Iterable<JournalEntry>} journals
 * @returns {JournalEntry[]}
 */
export function unfiledJournals(journals) {
  return Array.from(journals).filter(j => !j._source.folder && isModuleJournal(j._source));
}

/**
 * Prepare the folder when the world starts, and the first time, file the journals made before it.
 *
 * Runs on the active GM's client only, so two GMs do not each make a folder. Filing happens once per
 * world: after that, a case the GM drags back out of the folder stays out.
 * @returns {Promise<void>}
 */
export async function prepareCasesFolder() {
  if ( !game.users.activeGM?.isSelf || !usesCasesFolder() ) return;
  try {
    const folder = await ensureCasesFolder();
    if ( !folder || game.settings.get(MODULE_ID, SETTINGS.CASES_FOLDER_FILED) ) return;
    const updates = unfiledJournals(game.journal).map(j => ({_id: j.id, folder: folder.id}));
    if ( updates.length ) await getDocumentClass("JournalEntry").updateDocuments(updates);
    await game.settings.set(MODULE_ID, SETTINGS.CASES_FOLDER_FILED, true);
  }
  catch (error) {
    console.error(`${MODULE_ID} | the cases folder could not be prepared`, error);
  }
}
