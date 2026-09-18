import {assert, check, describe} from "./harness.mjs";

const MODULE_ID = "investigation-board";

/** A stand-in case owned by `assignedTo`, with the given ownership map. */
function caseWith({assignedTo, ownership = {}, isOwner = true} = {}) {
  return {
    id: "case1",
    uuid: "JournalEntry.case1",
    isOwner,
    ownership,
    getFlag: (scope, key) =>
      (scope === MODULE_ID && key === "assignedTo" ? assignedTo : undefined)
  };
}

/** Swap in a user list for the duration of a check. */
function withUsers(users) {
  const previous = globalThis.game.users;
  const collection = users.slice();
  collection.has = id => users.some(u => u.id === id);
  globalThis.game.users = collection;
  return () => { globalThis.game.users = previous; };
}

/**
 * Checks for who may share a case and what ownership map results.
 *
 * Sharing is the one operation that genuinely needs a GM — the server refuses a non-GM any change
 * to `ownership` beyond their own entry — so the rules about who may ask, and what the relay does
 * with a request, are worth pinning down precisely.
 */
export default async function testSharing() {
  const {canShareDirectly, canManageSharing, ownershipFor, currentSharing, handleShareQuery} =
    await import("../scripts/data/sharing.mjs");

  const levels = CONST.DOCUMENT_OWNERSHIP_LEVELS;
  const gm = {id: "gm", isGM: true};
  const owner = {id: "p1", isGM: false};
  const other = {id: "p2", isGM: false};

  describe("canShareDirectly");

  // isGM covers Assistant GMs, and the server treats them the same for ownership.
  await check("only a GM or Assistant GM may change ownership themselves", () => {
    assert(canShareDirectly(gm) === true, "a GM was refused");
    assert(canShareDirectly(owner) === false, "a player was allowed to change ownership directly");
  });

  describe("canManageSharing");

  await check("the GM may always share", () => {
    assert(canManageSharing(caseWith({assignedTo: "p1"}), gm) === true, "the GM was refused");
  });

  // Otherwise it is the case's own player — not merely anyone it has been shared with, or a
  // party-wide case could be re-shared by any of them.
  await check("only the case's own player may share it", () => {
    const journal = caseWith({assignedTo: "p1"});
    assert(canManageSharing(journal, owner) === true, "the case's owner was refused");
    assert(canManageSharing(journal, other) === false,
      "someone the case was merely shared with could re-share it");
  });

  await check("a case with nobody assigned falls back to document ownership", () => {
    assert(canManageSharing(caseWith({isOwner: true}), owner) === true,
      "an owner of an unassigned case was refused");
    assert(canManageSharing(caseWith({isOwner: false}), other) === false,
      "a non-owner of an unassigned case was allowed");
  });

  await check("a missing case is never shareable", () => {
    assert(canManageSharing(null, gm) === false, "null should not be shareable");
  });

  describe("ownershipFor");

  await check("grants the named players and nobody else", () => {
    const restore = withUsers([gm, owner, other]);
    const ownership = ownershipFor(caseWith({assignedTo: "p1"}), {userIds: ["p2"]});
    restore();
    assert(ownership.default === levels.NONE, "the world should not get access");
    assert(ownership.p2 === levels.OWNER, "the named player was not granted access");
  });

  await check("the whole party option opens it to everyone", () => {
    const restore = withUsers([gm, owner, other]);
    const ownership = ownershipFor(caseWith({assignedTo: "p1"}), {wholeParty: true});
    restore();
    assert(ownership.default === levels.OWNER, `default was ${ownership.default}`);
  });

  // Sharing must never orphan a case, so its own player always keeps it.
  await check("the case's own player always keeps it", () => {
    const restore = withUsers([gm, owner, other]);
    const ownership = ownershipFor(caseWith({assignedTo: "p1"}), {userIds: ["p2"]});
    restore();
    assert(ownership.p1 === levels.OWNER, "the case's player lost their own case");
  });

  // Only a GM can repair sharing later, so they must not be able to lock themselves out.
  await check("every GM keeps access", () => {
    const restore = withUsers([gm, owner, other]);
    const ownership = ownershipFor(caseWith({assignedTo: "p1"}), {userIds: []});
    restore();
    assert(ownership.gm === levels.OWNER, "a GM lost access to a case");
  });

  describe("currentSharing");

  await check("reads back who a case is shared with", () => {
    const sharing = currentSharing(caseWith({
      ownership: {default: levels.NONE, p1: levels.OWNER, p2: levels.OBSERVER, p3: levels.NONE}
    }));
    assert(sharing.wholeParty === false, "should not report party-wide");
    assert(sharing.userIds.has("p1") && sharing.userIds.has("p2"), "missed a shared-with user");
    assert(!sharing.userIds.has("p3"), "a user with no access was reported as shared with");
  });

  await check("treats observer-by-default as shared with the party", () => {
    const sharing = currentSharing(caseWith({ownership: {default: levels.OBSERVER}}));
    assert(sharing.wholeParty === true, "party-wide access was not detected");
  });

  describe("handleShareQuery");

  // A relayed request must not become a way around the permission check.
  await check("refuses a relayed request from someone who may not share", async () => {
    const journal = caseWith({assignedTo: "p1"});
    const previousFrom = globalThis.fromUuid;
    globalThis.fromUuid = async () => journal;

    const result = await handleShareQuery({caseUuid: journal.uuid, userIds: ["p2"]}, {user: other});
    globalThis.fromUuid = previousFrom;
    assert(result.error === "not-permitted", `got ${JSON.stringify(result)}`);
  });

  await check("refuses a request naming a case that does not exist", async () => {
    const previousFrom = globalThis.fromUuid;
    globalThis.fromUuid = async () => null;
    const result = await handleShareQuery({caseUuid: "JournalEntry.ghost"}, {user: gm});
    globalThis.fromUuid = previousFrom;
    assert(result.error === "unknown-case", `got ${JSON.stringify(result)}`);
  });

  await check("drops user ids that are not real users", async () => {
    let written = null;
    const journal = caseWith({assignedTo: "p1"});
    journal.update = async data => { written = data; };

    const previousFrom = globalThis.fromUuid;
    globalThis.fromUuid = async () => journal;
    const restore = withUsers([gm, owner, other]);

    const result = await handleShareQuery(
      {caseUuid: journal.uuid, userIds: ["p2", "nobody"]}, {user: owner}
    );

    restore();
    globalThis.fromUuid = previousFrom;
    assert(result.ok === true, `got ${JSON.stringify(result)}`);
    assert(written.ownership.p2 === levels.OWNER, "the real user was not granted access");
    assert(!("nobody" in written.ownership), "a made-up user id reached the ownership map");
  });
}
