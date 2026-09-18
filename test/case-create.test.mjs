import {assert, check, describe} from "./harness.mjs";

/**
 * Checks for building a new case and for the GM relay.
 *
 * `JOURNAL_CREATE` defaults to Trusted Player, so an ordinary Player cannot create a JournalEntry.
 * The relay is what keeps the module usable without promoting every player, and the shape of the
 * data it produces is what decides who ends up owning the case — worth pinning down.
 */
export default async function testCaseCreate() {
  const {caseData, canCreateDirectly, findActiveGM, handleCreateCaseQuery} =
    await import("../scripts/data/case-create.mjs");

  describe("caseData");

  await check("makes the requesting user the sole owner by default", () => {
    const data = caseData({name: "The Ashwood Murders", ownerId: "player1"});
    assert(data.ownership.default === CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE,
      `default ownership was ${data.ownership.default}`);
    assert(data.ownership.player1 === CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER,
      "the requesting user is not an owner");
    assert(Object.keys(data.ownership).length === 2, "someone else was given access");
  });

  await check("flags it as a case, assigned to its owner", () => {
    const flags = caseData({name: "X", ownerId: "player1"}).flags["investigation-board"];
    assert(flags.isCase === true, "not flagged as a case");
    assert(flags.assignedTo === "player1", `assignedTo was ${flags.assignedTo}`);
    assert(flags.status === "active", `status was ${flags.status}`);
    assert(flags.progress === 0, `progress was ${flags.progress}`);
    assert(flags.archived === false, "a new case should not be archived");
  });

  // The one piece of sharing a player can set for themselves. The server refuses a non-GM
  // changing `default` on update, but permits it on creation — so a Trusted Player can start a
  // party-wide case with no GM involved.
  await check("sets default ownership from the chosen visibility", () => {
    const levels = CONST.DOCUMENT_OWNERSHIP_LEVELS;
    const of = visibility => caseData({name: "X", ownerId: "p", visibility}).ownership;

    assert(of("party").default === levels.OWNER, "the party should be able to work on it");
    assert(of("partyRead").default === levels.OBSERVER, "the party should be able to watch it");
    assert(of("private").default === levels.NONE, "a private case should be hidden");
    assert(of(undefined).default === levels.NONE, "an unspecified case should default to private");
    assert(of("nonsense").default === levels.NONE, "an unknown visibility should fall back to private");
  });

  await check("the creator owns the case whatever the visibility", () => {
    for ( const visibility of ["party", "partyRead", "private"] ) {
      const ownership = caseData({name: "X", ownerId: "p", visibility}).ownership;
      assert(ownership.p === CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER,
        `the creator was not an owner under "${visibility}"`);
    }
  });

  await check("carries a classification when given one", () => {
    const flags = caseData({name: "X", ownerId: "p", classification: "Homicide"})
      .flags["investigation-board"];
    assert(flags.classification === "Homicide", `classification was ${flags.classification}`);
  });

  describe("canCreateDirectly");

  await check("follows the user's JOURNAL_CREATE permission", () => {
    assert(canCreateDirectly({can: p => p === "JOURNAL_CREATE"}) === true,
      "a permitted user was refused");
    assert(canCreateDirectly({can: () => false}) === false, "an unpermitted user was allowed");
  });

  describe("findActiveGM");

  const withUsers = users => {
    const previous = globalThis.game.users;
    globalThis.game.users = {find: fn => users.find(fn)};
    return () => { globalThis.game.users = previous; };
  };

  // isGM is true for Assistant GMs too, and the server treats them the same for ownership.
  await check("finds a connected GM, ignoring offline and non-GM users", () => {
    let restore = withUsers([
      {id: "p", active: true, isGM: false},
      {id: "gm", active: true, isGM: true}
    ]);
    assert(findActiveGM()?.id === "gm", "did not find the connected GM");
    restore();

    restore = withUsers([
      {id: "p", active: true, isGM: false},
      {id: "gm", active: false, isGM: true}
    ]);
    assert(findActiveGM() === undefined, "an offline GM was treated as available");
    restore();
  });

  describe("handleCreateCaseQuery");

  await check("refuses a request naming a user who does not exist", async () => {
    const previous = globalThis.game.users;
    globalThis.game.users = {get: () => undefined};
    const result = await handleCreateCaseQuery({name: "X", classification: "", ownerId: "ghost"});
    globalThis.game.users = previous;
    assert(result.error === "unknown-user", `got ${JSON.stringify(result)}`);
  });

  // The GM's client acts on a player's request, so what arrives is treated as untrusted input.
  await check("clamps an over-long name and falls back on an empty one", async () => {
    const previousUsers = globalThis.game.users;
    const previousJE = globalThis.JournalEntry;
    globalThis.game.users = {get: id => ({id})};

    let created = null;
    globalThis.JournalEntry = {
      create: async data => {
        created = data;
        return {uuid: `JournalEntry.${data.name.length}`};
      }
    };

    await handleCreateCaseQuery({name: "z".repeat(500), classification: "c".repeat(300), ownerId: "p"});
    assert(created.name.length === 200, `name length was ${created.name.length}`);
    assert(created.flags["investigation-board"].classification.length === 100,
      "classification was not clamped");

    await handleCreateCaseQuery({name: "   ", classification: "", ownerId: "p"});
    assert(created.name.length > 0, "an empty name was allowed through");

    globalThis.game.users = previousUsers;
    globalThis.JournalEntry = previousJE;
  });

  await check("creates the case for the requesting user, not the GM", async () => {
    const previousUsers = globalThis.game.users;
    const previousJE = globalThis.JournalEntry;
    globalThis.game.users = {get: id => ({id})};

    let created = null;
    globalThis.JournalEntry = {
      create: async data => { created = data; return {uuid: "JournalEntry.abc"}; }
    };

    const result = await handleCreateCaseQuery({name: "Case", classification: "", ownerId: "player7"});
    assert(result.uuid === "JournalEntry.abc", `got ${JSON.stringify(result)}`);
    assert(created.ownership.player7 === CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER,
      "the requesting player did not end up owning it");

    globalThis.game.users = previousUsers;
    globalThis.JournalEntry = previousJE;
  });
}
