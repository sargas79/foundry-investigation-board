import {assert, check, describe} from "./harness.mjs";

/**
 * Checks that a clue records who pinned it, by character.
 *
 * The point is traceability across a campaign, so the interesting cases are the ones where the
 * world has moved on since: the actor renamed, reassigned to someone else, or deleted outright.
 */
export default async function testAuthorship() {
  const {authorStamp, authorName, authorColor, characterName} =
    await import("../scripts/data/authorship.mjs");

  /** Install a world where a user may or may not have a character. */
  function withWorld({character = null, userName = "diego", actors = {}} = {}) {
    const previous = {game: globalThis.game, fromUuidSync: globalThis.fromUuidSync};
    globalThis.game = {
      user: {id: "u1", name: userName, character},
      users: {get: id => (id === "u1"
        ? {id: "u1", name: userName, character, color: {css: "#aa3344"}}
        : undefined)}
    };
    globalThis.fromUuidSync = uuid => actors[uuid] ?? null;
    return () => Object.assign(globalThis, previous);
  }

  // #60: a byline has to fit on a 180px lead, and the token name is the short one a table says
  // out loud. Foundry seeds it from the actor name, so for most actors the two are the same string.
  describe("characterName");

  await check("prefers the prototype token's name", () => {
    const name = characterName({name: "Bartholomew Ashworth III", prototypeToken: {name: "Bart"}});
    assert(name === "Bart", `showed ${name}`);
  });

  await check("falls back to the actor when the token has no name of its own", () => {
    assert(characterName({name: "Mara Vale", prototypeToken: {name: ""}}) === "Mara Vale",
      "an empty token name was preferred over the actor's");
    assert(characterName({name: "Mara Vale"}) === "Mara Vale",
      "an actor with no prototype token lost its name");
  });

  await check("says nothing for no actor at all", () => {
    assert(characterName(null) === "", "invented a name for a missing actor");
    assert(characterName(undefined) === "", "invented a name for a missing actor");
  });

  describe("authorStamp");

  // At the table people are their characters, not their accounts.
  await check("records the character's name, not the account's", () => {
    const restore = withWorld({character: {uuid: "Actor.mara", name: "Mara Vale"}});
    const stamp = authorStamp();
    restore();
    assert(stamp.createdByName === "Mara Vale", `recorded ${stamp.createdByName}`);
    assert(stamp.createdByActor === "Actor.mara", `actor was ${stamp.createdByActor}`);
    assert(stamp.createdBy === "u1", "the account was not recorded alongside");
  });

  await check("snapshots the token name, since that is what the byline will show", () => {
    const restore = withWorld({
      character: {uuid: "Actor.bart", name: "Bartholomew Ashworth III", prototypeToken: {name: "Bart"}}
    });
    const stamp = authorStamp();
    restore();
    assert(stamp.createdByName === "Bart", `recorded ${stamp.createdByName}`);
  });

  // Normally the GM, who has no character assigned.
  await check("falls back to the account name when there is no character", () => {
    const restore = withWorld({character: null, userName: "diego"});
    const stamp = authorStamp();
    restore();
    assert(stamp.createdByName === "diego", `recorded ${stamp.createdByName}`);
    assert(stamp.createdByActor === null, "an actor was invented from nowhere");
  });

  describe("authorName");

  await check("shows the live actor's token name over the recorded one", () => {
    const restore = withWorld({
      actors: {"Actor.bart": {name: "Bartholomew Ashworth III", prototypeToken: {name: "Bart"}}}
    });
    const name = authorName({
      createdBy: "u1", createdByActor: "Actor.bart", createdByName: "Bartholomew Ashworth III"
    });
    restore();
    assert(name === "Bart", `showed ${name}`);
  });

  await check("prefers the actor as it stands now, so a rename follows through", () => {
    const restore = withWorld({
      actors: {"Actor.mara": {name: "Mara Vale-Ashworth"}}
    });
    const name = authorName({
      createdBy: "u1", createdByActor: "Actor.mara", createdByName: "Mara Vale"
    });
    restore();
    assert(name === "Mara Vale-Ashworth", `showed ${name}`);
  });

  // The snapshot is what keeps a board honest across a campaign: a player who swaps character
  // must not silently rewrite who found the broken watch.
  await check("falls back to the recorded name when the actor is gone", () => {
    const restore = withWorld({actors: {}});
    const name = authorName({
      createdBy: "u1", createdByActor: "Actor.deleted", createdByName: "Mara Vale"
    });
    restore();
    assert(name === "Mara Vale", `showed ${name}`);
  });

  await check("falls back to the account when only that was recorded", () => {
    const restore = withWorld({userName: "diego"});
    const name = authorName({createdBy: "u1", createdByActor: null, createdByName: ""});
    restore();
    assert(name === "diego", `showed ${name}`);
  });

  // Clues pinned before any of this existed carry no stamp at all.
  await check("says nothing when nothing was recorded", () => {
    const restore = withWorld();
    assert(authorName({}) === null, "invented an author for an unstamped clue");
    assert(authorName(null) === null, "threw or invented an author for a missing stamp");
    assert(authorName({createdBy: "gone", createdByActor: null, createdByName: ""}) === null,
      "invented an author for a user who no longer exists");
    restore();
  });

  describe("authorColor");

  await check("takes the colour of the player behind the character", () => {
    const restore = withWorld({character: {uuid: "Actor.mara", name: "Mara"}});
    assert(authorColor({createdBy: "u1"}) === "#aa3344", "the player's colour was not used");
    assert(authorColor({createdBy: "gone"}) === null, "a colour was invented for a missing user");
    assert(authorColor({}) === null, "a colour was invented from nothing");
    restore();
  });

  describe("the stamp reaches the clue model");

  await check("ClueData carries the stamp through validation", async () => {
    const {default: ClueData} = await import("../scripts/data/clue-data.mjs");
    const clue = new ClueData({
      createdBy: "u1", createdByActor: "Actor.abcdefghijklmnop",
      createdByName: "Mara Vale", createdAt: 1700000000
    });
    assert(clue.createdBy === "u1", "the account was lost");
    assert(clue.createdByActor === "Actor.abcdefghijklmnop", "the actor reference was lost");
    assert(clue.createdByName === "Mara Vale", "the recorded name was lost");
    assert(clue.createdAt === 1700000000, "the time was lost");
  });

  await check("a clue with no stamp is still valid", async () => {
    const {default: ClueData} = await import("../scripts/data/clue-data.mjs");
    const clue = new ClueData({});
    assert(clue.createdBy === null, `createdBy defaulted to ${clue.createdBy}`);
    assert(clue.createdByActor === null, `createdByActor defaulted to ${clue.createdByActor}`);
    assert(clue.createdByName === "", "createdByName should default empty");
  });
}
