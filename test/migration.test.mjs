import {assert, check, describe} from "./harness.mjs";

const OLD = "investigation-board";
const NEW = "sargas-investigation-board";

/** Stand-ins for Foundry's `_replace` and `_del`, so the output can be inspected. */
const replace = value => ({replaced: value});
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
      {_id: "c1", type: `${OLD}.clue`, system: {title: "Docks"}, flags: {}},
      {_id: "l1", type: `${OLD}.connection`, system: {from: "c1", to: "c2"}},
      {_id: "r1", type: `${OLD}.report`, system: {body: "x"},
        flags: {core: {sheetClass: `${OLD}.ReportPageSheet`}}},
      {_id: "t1", type: "text", text: {content: "notes"}}
    ]
  };

  await check("changes each page's sub-type and replaces its system data", () => {
    const {pages} = legacyChanges(legacyCase, replace, DELETE);
    const clue = pages.find(p => p._id === "c1");
    assert(clue.type === `${NEW}.clue`, `type was ${clue.type}`);
    assert(clue.system.replaced.title === "Docks", "system data was not carried over");
    assert(pages.find(p => p._id === "l1").type === `${NEW}.connection`, "connection not moved");
  });

  await check("leaves pages that are not this module's alone", () => {
    const {pages} = legacyChanges(legacyCase, replace, DELETE);
    assert(!pages.some(p => p._id === "t1"), "a core text page was changed");
  });

  await check("moves the journal's flags and deletes the old scope", () => {
    const {journal} = legacyChanges(legacyCase, replace, DELETE);
    assert(journal.flags[NEW].status === "cold", "status flag not moved");
    assert(journal.flags[OLD] === DELETE, "old scope not deleted");
  });

  await check("points a sheet chosen by hand at its new registration", () => {
    const {pages} = legacyChanges(legacyCase, replace, DELETE);
    const report = pages.find(p => p._id === "r1");
    assert(report.flags.core.sheetClass === `${NEW}.ReportPageSheet`,
      `sheet was ${report.flags.core?.sheetClass}`);
  });

  await check("prefers a flag already written under the new id", () => {
    const {journal} = legacyChanges({
      flags: {[OLD]: {status: "cold"}, [NEW]: {status: "solved"}}, pages: []
    }, replace, DELETE);
    assert(journal.flags[NEW].status === "solved", "the newer value was overwritten");
  });

  await check("does nothing to a world that is already migrated", () => {
    const {journal, pages} = legacyChanges({
      flags: {[NEW]: {isCase: true}},
      pages: [{_id: "c1", type: `${NEW}.clue`, system: {}, flags: {}}]
    }, replace, DELETE);
    assert(journal === null, "a clean journal was updated");
    assert(pages.length === 0, "a clean page was updated");
  });

  await check("does not claim another package's sub-types under the old scope", () => {
    const {pages} = legacyChanges({
      pages: [{_id: "x", type: `${OLD}.pinboard`, system: {}}]
    }, replace, DELETE);
    assert(pages.length === 0, "an unknown sub-type was migrated");
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
