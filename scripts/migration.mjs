import {LEGACY_MODULE_ID, MODULE_ID, SETTINGS} from "./constants.mjs";

/**
 * Carry a world across the rename from `investigation-board` to `sargas-investigation-board`.
 *
 * The old id collided with another package on the Foundry registry, and Foundry resolves updates
 * through the registry by id, so the update button replaced this module with that one. The id had
 * to change — and everything a world stores is keyed by it: the page sub-types, the flags on cases
 * and handouts, and the world setting.
 *
 * Pages whose sub-type belongs to no active module are loaded as *invalid* documents: kept in the
 * journal's source but never initialised. They cannot be updated in place — Foundry V14's client
 * drops the server's reply for a document it holds as invalid, so the update is never applied — but
 * they can be deleted. So each one is recreated under the new sub-type with the same id, which keeps
 * every connection and every link pointing at it intact.
 *
 * Before anything is deleted, the new pages are validated and the old ones are copied onto the
 * journal's own flags. If the world goes down between the delete and the create, the next start
 * recreates them from that copy.
 *
 * It runs on every start for the active GM and does nothing once a world is clean, so there is no
 * "already migrated" marker to get out of step with the data.
 *
 * @module investigation-board/migration
 */

/** The sub-type suffixes this module declares. */
const SUBTYPES = ["clue", "connection", "report", "handout"];

/** The journal flag holding the old pages while they are being recreated. */
const BACKUP_FLAG = "legacyPages";

/* -------------------------------------------- */

/**
 * Work out the changes one journal needs. Pure, so it can be tested without a running world.
 *
 * @param {object} source          The journal's `_source`.
 * @param {unknown} deletion       The operator that deletes a key.
 * @returns {{journal: object|null, pages: object[], recreate: object[], backup: object[]}}
 *   `journal` and `pages` are updates; `recreate` holds the full source of each page to create under
 *   the new sub-type, and `backup` the old source of each, to keep until they exist.
 */
export function legacyChanges(source, deletion) {
  const journal = moveFlags(source.flags, deletion);
  const pages = [];
  const recreate = [];
  const backup = [];

  // Pages left behind by a migration that stopped between deleting and creating them.
  const present = new Set((source.pages ?? []).map(p => p._id));
  const stranded = (source.flags?.[MODULE_ID]?.[BACKUP_FLAG] ?? []).filter(p => !present.has(p._id));

  for ( const page of [...(source.pages ?? []), ...stranded] ) {
    const subtype = legacySubtype(page.type);
    if ( subtype ) {
      const data = foundry.utils.deepClone(page);
      data.type = `${MODULE_ID}.${subtype}`;
      const flags = moveFlags(data.flags, deletion)?.flags;
      if ( flags ) data.flags = settle({...data.flags, ...flags}, deletion);
      recreate.push(data);
      backup.push(page);
      continue;
    }
    const flags = moveFlags(page.flags, deletion);
    if ( flags ) pages.push({_id: page._id, ...flags});
  }
  return {journal, pages, recreate, backup};
}

/**
 * The part of a page type after this module's old id, if the page is one of ours.
 * @param {string} type
 * @returns {string|null}
 */
function legacySubtype(type) {
  const [scope, subtype] = String(type).split(/\.(.*)/);
  return ((scope === LEGACY_MODULE_ID) && SUBTYPES.includes(subtype)) ? subtype : null;
}

/**
 * Move a document's flags from the old scope to the new one, and point a sheet chosen by hand at
 * the sheet's new registration.
 * @param {object} [flags]
 * @param {unknown} deletion
 * @returns {{flags: object}|null}
 */
function moveFlags(flags, deletion) {
  if ( !flags ) return null;
  const update = {};
  if ( flags[LEGACY_MODULE_ID] ) {
    // Anything already written under the new id is newer, so it wins.
    update[MODULE_ID] = {...flags[LEGACY_MODULE_ID], ...flags[MODULE_ID]};
    update[LEGACY_MODULE_ID] = deletion;
  }
  const sheet = flags.core?.sheetClass;
  if ( sheet?.startsWith(`${LEGACY_MODULE_ID}.`) ) {
    update.core = {...flags.core, sheetClass: `${MODULE_ID}${sheet.slice(LEGACY_MODULE_ID.length)}`};
  }
  return Object.keys(update).length ? {flags: update} : null;
}

/**
 * Turn an update's flags into plain data for a document being created: drop the deleted keys.
 * @param {object} flags
 * @param {unknown} deletion
 * @returns {object}
 */
function settle(flags, deletion) {
  return Object.fromEntries(Object.entries(flags).filter(([, v]) => v !== deletion));
}

/* -------------------------------------------- */

/**
 * Migrate the running world, if it needs it.
 * @returns {Promise<void>}
 */
export async function migrateLegacyData() {
  if ( !game.users.activeGM?.isSelf ) return;

  // That id is the other package now. If it is active here, its data is not ours to take.
  if ( game.modules.get(LEGACY_MODULE_ID)?.active ) {
    console.warn(`${MODULE_ID} | "${LEGACY_MODULE_ID}" is active; skipping migration of its data`);
    return;
  }

  let migrated = 0;
  const failures = [];
  try {
    migrated += await migrateSettings();
  }
  catch (error) {
    failures.push(error);
    console.error(`${MODULE_ID} | migrating settings from "${LEGACY_MODULE_ID}" failed`, error);
  }

  // One journal that cannot be moved must not hold back the rest.
  for ( const journal of game.journal ) {
    try {
      if ( await migrateJournal(journal) ) migrated++;
    }
    catch (error) {
      failures.push(error);
      console.error(`${MODULE_ID} | migrating "${journal.name}" [${journal.id}] from `
        + `"${LEGACY_MODULE_ID}" failed`, error);
    }
  }

  if ( failures.length ) {
    ui.notifications.error(game.i18n.format("INVESTIGATION_BOARD.NOTIFY.MigrationFailed",
      {error: failures[0].message}), {permanent: true});
  }
  if ( !migrated ) return;
  console.log(`${MODULE_ID} | migrated ${migrated} document(s) from "${LEGACY_MODULE_ID}"`);
  ui.notifications.info("INVESTIGATION_BOARD.NOTIFY.Migrated", {localize: true, permanent: true});
}

/**
 * Migrate one journal and its pages.
 * @param {JournalEntry} journal
 * @returns {Promise<boolean>}   Whether anything changed.
 */
async function migrateJournal(journal) {
  const {journal: update, pages, recreate, backup} = legacyChanges(journal._source, _del);
  if ( !update && !pages.length && !recreate.length ) return false;

  // Refuse before touching anything if a recreated page would not be accepted.
  const cls = getDocumentClass("JournalEntryPage");
  for ( const data of recreate ) new cls(data, {parent: journal, strict: true});

  // Keep a copy of the old pages on the journal until their replacements exist.
  const journalUpdate = update ?? {};
  if ( recreate.length ) {
    journalUpdate.flags ??= {};
    journalUpdate.flags[MODULE_ID] = {...journalUpdate.flags[MODULE_ID], [BACKUP_FLAG]: backup};
  }
  if ( Object.keys(journalUpdate).length ) await journal.update(journalUpdate, {render: false});

  if ( pages.length ) await journal.updateEmbeddedDocuments("JournalEntryPage", pages, {render: false});
  if ( recreate.length ) {
    const ids = recreate.map(p => p._id).filter(id => journal.pages.invalidDocumentIds.has(id));
    if ( ids.length ) await journal.deleteEmbeddedDocuments("JournalEntryPage", ids, {render: false});
    await journal.createEmbeddedDocuments("JournalEntryPage", recreate, {keepId: true, render: false});
    await journal.update({flags: {[MODULE_ID]: {[BACKUP_FLAG]: _del}}}, {render: false});
  }
  return true;
}

/* -------------------------------------------- */

/**
 * Copy world settings saved under the old id, unless the new id already has its own value.
 *
 * A Setting document's `value` is already parsed from JSON, and a key nobody registers any more
 * keeps it that way, so it is copied as it stands. Parsing it again threw on any saved string.
 *
 * @returns {Promise<number>}   How many settings were copied.
 */
export async function migrateSettings() {
  const storage = game.settings.storage.get("world");
  let copied = 0;
  for ( const key of Object.values(SETTINGS) ) {
    const legacy = storage.getSetting(`${LEGACY_MODULE_ID}.${key}`);
    if ( !legacy || storage.getSetting(`${MODULE_ID}.${key}`) ) continue;
    await game.settings.set(MODULE_ID, key, legacy.value);
    copied++;
  }
  return copied;
}
