import {assert, assertThrows, check, describe} from "./harness.mjs";

const MODULE_ID = "investigation-board";

/** A stand-in handout entry with the given ownership map. */
function handoutWith({ownership = {}, kind = "death", image = null, name = "Coroner's Report"} = {}) {
  const page = {
    id: "page1",
    type: `${MODULE_ID}.handout`,
    system: {kind, image, rows: []}
  };
  return {
    id: "h1",
    uuid: "JournalEntry.h1",
    name,
    ownership,
    pages: [page],
    getFlag: (scope, key) => (scope === MODULE_ID && key === "isHandout" ? true : undefined)
  };
}

/** Swap in a user list for the duration of a check. */
function withUsers(users) {
  const previous = globalThis.game.users;
  const collection = users.slice();
  collection.has = id => users.some(u => u.id === id);
  collection.get = id => users.find(u => u.id === id);
  globalThis.game.users = collection;
  return () => { globalThis.game.users = previous; };
}

/**
 * Checks for the documents a GM writes and hands over.
 *
 * The rules worth pinning down are the ones a reader cannot verify by looking at the UI: that an
 * unshared document grants nobody anything, that handing one over grants *Observer* and not Owner,
 * and that a card pinned from a document carries a link rather than the document's contents. Each
 * of those is a decision that would silently become a leak if it drifted.
 */
export default async function testHandouts() {
  const {
    canManageHandouts,
    currentHolders,
    handoutClueData,
    handoutOwnership,
    handoutPage,
    isHandout,
    isShared,
    seedRows
  } = await import("../scripts/data/handouts.mjs");
  const {default: HandoutData} = await import("../scripts/data/handout-data.mjs");
  const {HANDOUT_KINDS} = await import("../scripts/constants.mjs");

  const levels = CONST.DOCUMENT_OWNERSHIP_LEVELS;
  const gm = {id: "gm", isGM: true};
  const mara = {id: "p1", isGM: false};
  const silas = {id: "p2", isGM: false};

  describe("HandoutData");

  await check("applies defaults to an empty source", () => {
    const h = new HandoutData({});
    assert(h.kind === "document", `kind was ${h.kind}`);
    assert(h.issuer === "" && h.reference === "" && h.dateline === "", "text defaults wrong");
    assert(Array.isArray(h.rows) && !h.rows.length, "rows should default to an empty array");
  });

  await check("round-trips a populated document", () => {
    const h = new HandoutData({
      kind: "death",
      issuer: "City Coroner's Office",
      reference: "4471-B",
      dateline: "14th of Brume",
      body: "<p>Exsanguination.</p>",
      rows: [{label: "Deceased", value: "A. Vance"}, {label: "Cause", value: "Unknown"}]
    });
    assert(h.kind === "death", "kind not kept");
    assert(h.rows[0].value === "A. Vance", "row value not kept");
    assert(h.kindConfig.icon === HANDOUT_KINDS.death.icon, "kindConfig resolved to the wrong kind");
  });

  await check("rejects a kind that is not one of the offered ones", () => {
    assertThrows(() => new HandoutData({kind: "banana"}, {strict: true}), "a bad kind was accepted");
  });

  // Seeding a kind leaves blanks behind; printing them would put empty rules across the document.
  await check("filledRows drops the blanks a seeded kind leaves behind", () => {
    const h = new HandoutData({rows: [
      {label: "Deceased", value: "A. Vance"},
      {label: "Next of Kin", value: ""},
      {label: "", value: ""}
    ]});
    assert(h.filledRows.length === 2, `kept ${h.filledRows.length} rows, expected 2`);
    assert(!h.filledRows.some(r => !r.label && !r.value), "an entirely blank row survived");
  });

  describe("isHandout / handoutPage");

  await check("recognises a handout and finds its page", () => {
    const journal = handoutWith({});
    assert(isHandout(journal) === true, "a handout was not recognised");
    assert(isHandout(null) === false, "null should not be a handout");
    assert(handoutPage(journal)?.id === "page1", "the handout's page was not found");
  });

  await check("an entry with no handout page yields nothing", () => {
    const journal = {pages: [{id: "x", type: "text"}]};
    assert(handoutPage(journal) === undefined, "a text page was mistaken for a handout");
  });

  describe("canManageHandouts");

  // Assistant GMs count: isGM covers both, and the server treats them alike for ownership.
  await check("only a GM or Assistant GM may write and hand over documents", () => {
    assert(canManageHandouts(gm) === true, "a GM was refused");
    assert(canManageHandouts(mara) === false, "a player was allowed to write handouts");
    assert(canManageHandouts(null) === false, "nobody was allowed to write handouts");
  });

  describe("handoutOwnership");

  // The whole feature rests on this: an unshared document must reach nobody's client.
  await check("a document handed to nobody grants nobody anything", () => {
    const restore = withUsers([gm, mara, silas]);
    const ownership = handoutOwnership({});
    restore();
    assert(ownership.default === levels.NONE, `default was ${ownership.default}`);
    assert(!(mara.id in ownership), "a player was named on an unshared document");
  });

  // Observer, not Owner: the player reads the coroner's report, they do not get to rewrite it.
  await check("a named player is granted Observer and no more", () => {
    const restore = withUsers([gm, mara, silas]);
    const ownership = handoutOwnership({userIds: ["p1"]});
    restore();
    assert(ownership.p1 === levels.OBSERVER, `granted ${ownership.p1}, expected OBSERVER`);
    assert(ownership.p1 < levels.OWNER, "a player was made an owner of a handout");
    assert(!(silas.id in ownership), "a player who was not named received the document");
  });

  await check("the whole party option opens it to everyone, still as Observer", () => {
    const restore = withUsers([gm, mara, silas]);
    const ownership = handoutOwnership({wholeParty: true});
    restore();
    assert(ownership.default === levels.OBSERVER, `default was ${ownership.default}`);
  });

  // Only a GM can take a document back, so they must not be able to lock themselves out of one.
  await check("every GM keeps the document outright", () => {
    const restore = withUsers([gm, mara, silas]);
    const ownership = handoutOwnership({userIds: ["p1"]});
    restore();
    assert(ownership.gm === levels.OWNER, "a GM lost a document they wrote");
  });

  describe("currentHolders / isShared");

  await check("reads back who is holding a document", () => {
    const restore = withUsers([gm, mara, silas]);
    const holders = currentHolders(handoutWith({
      ownership: {default: levels.NONE, gm: levels.OWNER, p1: levels.OBSERVER, p2: levels.NONE}
    }));
    restore();
    assert(holders.wholeParty === false, "should not report party-wide");
    assert(holders.userIds.has("p1"), "the player holding it was missed");
    assert(!holders.userIds.has("p2"), "a player with no access was reported as holding it");
  });

  // A GM's own entry is bookkeeping; listing it would read as "handed to the GM".
  await check("a GM's own access is not reported as a hand-over", () => {
    const restore = withUsers([gm, mara, silas]);
    const holders = currentHolders(handoutWith({ownership: {gm: levels.OWNER}}));
    const shared = isShared(handoutWith({ownership: {gm: levels.OWNER}}));
    restore();
    assert(holders.userIds.size === 0, "the GM was listed as holding their own document");
    assert(shared === false, "a document only the GM has was reported as handed out");
  });

  await check("isShared is true once anyone holds it", () => {
    const restore = withUsers([gm, mara, silas]);
    const named = isShared(handoutWith({ownership: {p1: levels.OBSERVER}}));
    const party = isShared(handoutWith({ownership: {default: levels.OBSERVER}}));
    restore();
    assert(named === true, "a document handed to one player was not reported as shared");
    assert(party === true, "a party-wide document was not reported as shared");
  });

  describe("seedRows");

  await check("seeds the blanks a kind usually wants, and none for a plain document", () => {
    assert(seedRows("death").length === HANDOUT_KINDS.death.fields.length,
      "a death record did not get its blanks");
    assert(seedRows("death").every(row => row.value === ""), "a seeded row arrived filled in");
    assert(seedRows("document").length === 0, "a plain document was given blanks");
  });

  await check("an unknown kind falls back rather than throwing", () => {
    assert(Array.isArray(seedRows("banana")), "an unknown kind should still yield rows");
  });

  describe("handoutClueData");

  // Pinning must publish the *existence* of a document, never its contents: a player who pins
  // something handed to them alone must not thereby hand it to the rest of the party.
  await check("a pinned card links to the document and copies none of it", () => {
    const journal = handoutWith({kind: "police", image: "worlds/x/leads/vance.webp"});
    const clue = handoutClueData(journal);
    assert(clue.system.linkedUuid === "JournalEntry.h1", "the card does not link to the document");
    assert(clue.name === "Coroner's Report", "the card did not take the document's name");
    assert(clue.system.body === "", "the document's text was copied onto the card");
    assert(!("rows" in clue.system), "the document's particulars were copied onto the card");
  });

  // The link is to the entry, because the entry is what ownership hangs off.
  await check("the link is to the entry rather than its page", () => {
    const clue = handoutClueData(handoutWith({}));
    assert(!clue.system.linkedUuid.includes("JournalEntryPage"),
      `linked to ${clue.system.linkedUuid}, which bypasses the entry's ownership`);
  });

  await check("a card style wanting a photograph falls back when there is none", () => {
    const withPhoto = handoutClueData(handoutWith({kind: "police", image: "a.webp"}));
    const without = handoutClueData(handoutWith({kind: "police", image: null}));
    assert(withPhoto.system.template === "mugshot", `got ${withPhoto.system.template}`);
    assert(without.system.template === "document",
      `a photo-less record used the ${without.system.template} card, which draws an empty frame`);
  });

  await check("an entry with no handout page yields no card", () => {
    assert(handoutClueData({pages: [], name: "x", uuid: "JournalEntry.y"}) === null,
      "a card was built from an entry with nothing on it");
  });
}
