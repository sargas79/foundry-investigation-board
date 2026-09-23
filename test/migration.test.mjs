import {assert, check, describe} from "./harness.mjs";

const OLD = "investigation-board";
const NEW = "sargas-investigation-board";

/** A stand-in for Foundry's `_del`, so the output can be inspected. */
const DELETE = Symbol("delete");

/**
 * The rename from `investigation-board`: every page, flag and chosen sheet must move to the new id,
 * and nothing that is not this module's may be touched.
 */
export default async function testMigration() {
  const {legacyChanges} = await import("../scripts/migration.mjs");

  describe("migration from the old module id");

  const legacyCase = {
    flags: {[OLD]: {isCase: true, status: "cold"}},
    pages: [
      {_id: "c1", type: `${OLD}.clue`, system: {title: "Docks"}, flags: {[OLD]: {pinned: true}}},
      {_id: "l1", type: `${OLD}.connection`, system: {from: "c1", to: "c2"}},
      {_id: "r1", type: `${OLD}.report`, system: {body: "x"},
        flags: {core: {sheetClass: `${OLD}.ReportPageSheet`}}},
      {_id: "t1", type: "text", text: {content: "notes"}, flags: {[OLD]: {note: 1}}}
    ]
  };

  await check("recreates each old page under the new sub-type with the same id and data", () => {
    const {recreate} = legacyChanges(legacyCase, DELETE);
    const clue = recreate.find(p => p._id === "c1");
    assert(clue.type === `${NEW}.clue`, `type was ${clue.type}`);
    assert(clue.system.title === "Docks", "system data was not carried over");
    assert(recreate.find(p => p._id === "l1").type === `${NEW}.connection`, "connection not moved");
    assert(recreate.length === 3, `recreated ${recreate.length} page(s)`);
  });

  await check("moves a recreated page's flags as plain data, with no deletion operator", () => {
    const {recreate} = legacyChanges(legacyCase, DELETE);
    const clue = recreate.find(p => p._id === "c1");
    assert(clue.flags[NEW].pinned === true, "flag not moved");
    assert(!(OLD in clue.flags), "old scope left on a page being created");
  });

  await check("does not change the source it was given", () => {
    legacyChanges(legacyCase, DELETE);
    assert(legacyCase.pages[0].type === `${OLD}.clue`, "source page was mutated");
  });

  await check("backs up each old page exactly as it was", () => {
    const {backup} = legacyChanges(legacyCase, DELETE);
    assert(backup.length === 3, `backed up ${backup.length} page(s)`);
    assert(backup[0] === legacyCase.pages[0], "backup is not the original source");
  });

  await check("updates flags in place on pages that are not this module's", () => {
    const {pages, recreate} = legacyChanges(legacyCase, DELETE);
    assert(!recreate.some(p => p._id === "t1"), "a core text page was recreated");
    const text = pages.find(p => p._id === "t1");
    assert(text.flags[NEW].note === 1 && text.flags[OLD] === DELETE, "text page flags not moved");
  });

  await check("moves the journal's flags and deletes the old scope", () => {
    const {journal} = legacyChanges(legacyCase, DELETE);
    assert(journal.flags[NEW].status === "cold", "status flag not moved");
    assert(journal.flags[OLD] === DELETE, "old scope not deleted");
  });

  await check("points a sheet chosen by hand at its new registration", () => {
    const {recreate} = legacyChanges(legacyCase, DELETE);
    const report = recreate.find(p => p._id === "r1");
    assert(report.flags.core.sheetClass === `${NEW}.ReportPageSheet`,
      `sheet was ${report.flags.core?.sheetClass}`);
  });

  await check("prefers a flag already written under the new id", () => {
    const {journal} = legacyChanges({
      flags: {[OLD]: {status: "cold"}, [NEW]: {status: "solved"}}, pages: []
    }, DELETE);
    assert(journal.flags[NEW].status === "solved", "the newer value was overwritten");
  });

  await check("does nothing to a world that is already migrated", () => {
    const {journal, pages, recreate} = legacyChanges({
      flags: {[NEW]: {isCase: true}},
      pages: [{_id: "c1", type: `${NEW}.clue`, system: {}, flags: {}}]
    }, DELETE);
    assert(journal === null, "a clean journal was updated");
    assert(!pages.length && !recreate.length, "a clean page was touched");
  });

  await check("does not claim another package's sub-types under the old scope", () => {
    const {pages, recreate} = legacyChanges({
      pages: [{_id: "x", type: `${OLD}.pinboard`, system: {}}]
    }, DELETE);
    assert(!pages.length && !recreate.length, "an unknown sub-type was migrated");
  });

  await check("recreates pages stranded by a migration that stopped after deleting them", () => {
    const lost = {_id: "c9", type: `${OLD}.clue`, system: {title: "Pier"}};
    const done = {_id: "c1", type: `${OLD}.clue`, system: {}};
    const {recreate} = legacyChanges({
      flags: {[NEW]: {legacyPages: [lost, done]}},
      pages: [{_id: "c1", type: `${NEW}.clue`, system: {}}]
    }, DELETE);
    assert(recreate.length === 1 && recreate[0]._id === "c9", `recreated ${recreate.map(p => p._id)}`);
    assert(recreate[0].type === `${NEW}.clue` && recreate[0].system.title === "Pier", "not restored");
  });

  await check("copies a saved string setting without parsing it twice", async () => {
    // A Setting's value is a JSONField, so Foundry hands it over already parsed.
    const stored = "Secret\nEyes Only";
    const field = new foundry.data.fields.JSONField();
    const legacy = {key: `${OLD}.classifications`, value: field.initialize(JSON.stringify(stored))};
    const saved = [];
    const previous = globalThis.game.settings;
    globalThis.game.settings = {
      storage: new Map([["world", {getSetting: key => (key === legacy.key ? legacy : undefined)}]]),
      set: async (scope, key, value) => saved.push({scope, key, value})
    };
    try {
      const {migrateSettings} = await import("../scripts/migration.mjs");
      const copied = await migrateSettings();
      assert(copied === 1, `copied ${copied} setting(s)`);
      assert(saved[0]?.value === stored, `saved ${JSON.stringify(saved[0]?.value)}`);
    }
    finally { globalThis.game.settings = previous; }
  });
}
