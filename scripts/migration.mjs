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
 * journal's source but never initialised. Their type is changed in place, with the system data
 * force-replaced as Foundry requires, so every page keeps its id and every string keeps its ends.
 *
 * It runs on every start for the active GM and does nothing once a world is clean, so there is no
 * "already migrated" marker to get out of step with the data.
 *
 * @module investigation-board/migration
 */

/** The sub-type suffixes this module declares. */
const SUBTYPES = ["clue", "connection", "report", "handout"];

/* -------------------------------------------- */

/**
 * Work out the changes one journal needs. Pure, so it can be tested without a running world.
 *
 * @param {object} source                        The journal's `_source`.
 * @param {(value: object) => unknown} replace   Wraps system data so it replaces rather than merges.
 * @param {unknown} deletion                     The operator that deletes a key.
 * @returns {{journal: object|null, pages: object[]}}
 */
export function legacyChanges(source, replace, deletion) {
  const journal = moveFlags(source.flags);

  const pages = [];
  for ( const page of source.pages ?? [] ) {
    const change = {};
    const [scope, subtype] = String(page.type).split(/\.(.*)/);
    if ( (scope === LEGACY_MODULE_ID) && SUBTYPES.includes(subtype) ) {
      change.type = `${MODULE_ID}.${subtype}`;
      change.system = replace(foundry.utils.deepClone(page.system ?? {}));
    }
    const flags = moveFlags(page.flags);
    if ( flags ) Object.assign(change, flags);
    if ( !Object.keys(change).length ) continue;
    pages.push({_id: page._id, ...change});
  }
  return {journal, pages};

  /**
   * Move a document's flags from the old scope to the new one, and point a sheet chosen by hand at
   * the sheet's new registration.
   * @param {object} [flags]
   * @returns {{flags: object}|null}
   */
  function moveFlags(flags) {
    if ( !flags ) return null;
    const update = {};
    if ( flags[LEGACY_MODULE_ID] ) {
      // Anything already written under the new id is newer, so it wins.
      update[MODULE_ID] = {...flags[LEGACY_MODULE_ID], ...flags[MODULE_ID]};
      update[LEGACY_MODULE_ID] = deletion;
    }
    const sheet = flags.core?.sheetClass;
    if ( sheet?.startsWith(`${LEGACY_MODULE_ID}.`) ) {
      update.core = {sheetClass: `${MODULE_ID}${sheet.slice(LEGACY_MODULE_ID.length)}`};
    }
    return Object.keys(update).length ? {flags: update} : null;
  }
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
  try {
    migrated += await migrateSettings();
    for ( const journal of game.journal ) {
      const {journal: update, pages} = legacyChanges(journal._source, _replace, _del);
      if ( pages.length ) {
        await journal.updateEmbeddedDocuments("JournalEntryPage", pages, {render: false});
      }
      if ( update ) await journal.update(update, {render: false});
      if ( update || pages.length ) migrated++;
    }
  }
  catch (error) {
    console.error(`${MODULE_ID} | migration from "${LEGACY_MODULE_ID}" failed`, error);
    ui.notifications.error("INVESTIGATION_BOARD.NOTIFY.MigrationFailed", {localize: true, permanent: true});
    return;
  }
  if ( !migrated ) return;

  // Pages that loaded as invalid are not re-initialised by an update, so this client, and any
  // player already connected, has to load the world again to see them. Reloading for the GM would
  // hide the one message that says so.
  console.log(`${MODULE_ID} | migrated ${migrated} document(s) from "${LEGACY_MODULE_ID}"`);
  ui.notifications.info("INVESTIGATION_BOARD.NOTIFY.Migrated", {localize: true, permanent: true});
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
