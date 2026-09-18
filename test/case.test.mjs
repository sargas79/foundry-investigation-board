import {assert, check, describe} from "./harness.mjs";

/** Build a stand-in JournalEntry carrying the given module flags. */
function journalWithFlags(flags) {
  return {
    id: "case1",
    name: "The Ashwood Murders",
    getFlag: (scope, key) => (scope === "investigation-board" ? flags[key] : undefined)
  };
}

/** Build a stand-in clue page. */
function clue(x, y, width) {
  return {system: {x, y, width}};
}

/**
 * Checks for the case helpers that need no live Foundry world — the flag reading the header
 * depends on, and the bounds used to frame a case when it opens.
 */
export default async function testCase() {
  const {caseState, clueBounds} = await import("../scripts/data/case.mjs");

  describe("caseState");

  check("falls back to an active case at zero progress", () => {
    const state = caseState(journalWithFlags({}));
    assert(state.status === "active", `status was ${state.status}`);
    assert(state.progress === 0, `progress was ${state.progress}`);
    assert(state.classification === "", "classification should default empty");
    assert(state.archived === false, "archived should default false");
    assert(state.assignedTo === null, "assignedTo should default null");
  });

  // The header renders `statusLabel` directly; a missing mapping would show a raw key to players.
  check("maps every status to a localization key", () => {
    for ( const status of ["active", "hold", "cold", "solved"] ) {
      const state = caseState(journalWithFlags({status}));
      assert(state.status === status, `status was ${state.status}`);
      assert(state.statusLabel.startsWith("INVESTIGATION_BOARD.STATUS."),
        `${status} gave label ${state.statusLabel}`);
    }
  });

  check("an unrecognised status still yields a usable label", () => {
    const state = caseState(journalWithFlags({status: "banana"}));
    assert(state.statusLabel.startsWith("INVESTIGATION_BOARD.STATUS."),
      `got ${state.statusLabel}`);
  });

  // Progress is player-set, so it has to survive whatever ends up in the flag.
  check("clamps and rounds progress into 0-100", () => {
    assert(caseState(journalWithFlags({progress: 140})).progress === 100, "should clamp above 100");
    assert(caseState(journalWithFlags({progress: -20})).progress === 0, "should clamp below 0");
    assert(caseState(journalWithFlags({progress: 67.6})).progress === 68, "should round");
  });

  check("reads classification, assignment and archived state", () => {
    const state = caseState(journalWithFlags({
      classification: "Homicide", assignedTo: "user123", archived: true
    }));
    assert(state.classification === "Homicide", "classification not read");
    assert(state.assignedTo === "user123", "assignedTo not read");
    assert(state.archived === true, "archived not read");
  });

  describe("clueBounds");

  check("returns null for a case with no clues", () => {
    assert(clueBounds([]) === null, "empty case should have no bounds");
  });

  check("spans every clue", () => {
    const bounds = clueBounds([clue(0, 0, 200), clue(500, 300, 100)]);
    assert(bounds.x === 0, `x was ${bounds.x}`);
    assert(bounds.width === 600, `width was ${bounds.width}`);
    assert(bounds.height > 300, `height was ${bounds.height}`);
  });

  check("handles clues at negative coordinates", () => {
    const bounds = clueBounds([clue(-300, -120, 180), clue(100, 40, 200)]);
    assert(bounds.x === -300, `x was ${bounds.x}`);
    assert(bounds.width === 600, `width was ${bounds.width}`);
    assert(bounds.y < -120, "bounds should sit above the topmost clue's pin");
  });
}
