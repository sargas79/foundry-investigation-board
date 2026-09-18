import {assert, check, describe} from "./harness.mjs";

const MODULE_ID = "investigation-board";
const SECRET = "the killer was the harbourmaster";

/**
 * Checks that redaction genuinely withholds text.
 *
 * This is the whole point of the feature, and it is easy to build something that only *looks*
 * right. Two mechanisms that seem like they would work do not:
 *
 * - `gmOnlyFields` guards `_sanitize`, which runs on write. It never withholds anything on read.
 * - Page ownership only filters display; `visible` is a client-side getter, so the client already
 *   holds the document it is deciding not to show.
 *
 * So the test that counts is simple and blunt: after redacting, the secret must not appear
 * anywhere in the page a player receives.
 */
export default async function testRedaction() {
  const {redactPassage, revealPassage, REDACTION_TAG} =
    await import("../scripts/data/redaction.mjs");

  /** A world where documents can be created and inspected. */
  function makeWorld({isGM = true} = {}) {
    const created = [];
    const sealedPages = new Map();

    const sealedEntry = {
      id: "sealed1",
      pages: {get: id => sealedPages.get(id)},
      createEmbeddedDocuments: async (type, records) => {
        for ( const r of records ) {
          sealedPages.set(r._id, {
            ...r,
            delete: async () => { sealedPages.delete(r._id); }
          });
        }
        return records;
      }
    };

    const flags = {};
    const journal = {
      id: "case1", name: "Ashwood",
      getFlag: (scope, key) => (scope === MODULE_ID ? flags[key] : undefined),
      setFlag: async (scope, key, value) => { flags[key] = value; }
    };

    const page = {
      id: "brief", name: "File", parent: journal,
      system: {kind: "brief", body: `<p>Victim found at 02:14. We believe ${SECRET}.</p>`, sealed: []},
      update: async changes => {
        if ( changes.system?.body !== undefined ) page.system.body = changes.system.body;
        if ( changes.system?.sealed !== undefined ) page.system.sealed = changes.system.sealed;
      }
    };

    globalThis.game = {
      user: {id: isGM ? "gm" : "p1", isGM},
      i18n: {localize: k => k, format: k => k},
      journal: {get: id => (id === "sealed1" ? sealedEntry : null)}
    };
    globalThis.ui = {notifications: {warn: () => {}, error: () => {}, info: () => {}}};
    globalThis.JournalEntry = {
      create: async data => {
        created.push(data);
        return sealedEntry;
      }
    };
    globalThis.CONST = {
      DOCUMENT_OWNERSHIP_LEVELS: {NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3},
      JOURNAL_ENTRY_PAGE_FORMATS: {HTML: 1}
    };

    return {journal, page, sealedEntry, sealedPages, created, flags};
  }

  describe("redacting");

  let world = makeWorld();
  let redactionId;

  await check("the passage is removed from the page entirely", async () => {
    redactionId = await redactPassage(world.page, SECRET, "a name");
    assert(!!redactionId, "redaction returned no id");
    // The blunt assertion: the secret is simply not in the page any more.
    assert(!world.page.system.body.includes(SECRET),
      `the secret survived in the page body: ${world.page.system.body}`);
  });

  await check("what is left behind reveals nothing", () => {
    const body = world.page.system.body;
    assert(body.includes(REDACTION_TAG), "no marker was left in place of the text");
    assert(body.includes("Victim found at 02:14"), "the surrounding text was lost");
    // Every field a player would receive, searched for any trace.
    const everythingAPlayerGets = JSON.stringify(world.page.system);
    assert(!everythingAPlayerGets.includes(SECRET),
      `the secret appears somewhere in the page data: ${everythingAPlayerGets}`);
    for ( const word of SECRET.split(" ") ) {
      if ( word.length < 5 ) continue;
      assert(!everythingAPlayerGets.includes(word),
        `the word "${word}" leaked into the page data`);
    }
  });

  await check("the marker records who and when, but no content", () => {
    const [marker] = world.page.system.sealed;
    assert(marker.id === redactionId, "the marker id does not match");
    assert(marker.sealedBy === "gm", `sealedBy was ${marker.sealedBy}`);
    assert(typeof marker.sealedAt === "number", "no timestamp was recorded");
    assert(!JSON.stringify(marker).includes(SECRET), "the marker carries the secret");
  });

  // The text has to go *somewhere* — a companion document players have no permission on.
  await check("the text is kept in a companion entry owned by nobody", () => {
    assert(world.created.length === 1, `created ${world.created.length} companion entries`);
    const [entry] = world.created;
    assert(entry.ownership.default === 0,
      `the companion entry is readable by default: ${JSON.stringify(entry.ownership)}`);
    assert(entry.flags[MODULE_ID].sealedFor === "case1", "the companion is not linked to the case");
    const stored = world.sealedPages.get(redactionId);
    assert(stored?.text?.content === SECRET, "the text was not stored where it can be recovered");
  });

  await check("the companion entry is reused rather than multiplied", async () => {
    await redactPassage(world.page, "Victim found at 02:14", "a time");
    assert(world.created.length === 1,
      `a second redaction created ${world.created.length} companion entries`);
    assert(world.page.system.sealed.length === 2, "the second redaction was not recorded");
  });

  describe("revealing");

  await check("the passage comes back into the page", async () => {
    const revealed = await revealPassage(world.page, redactionId);
    assert(revealed === true, "revealing reported failure");
    assert(world.page.system.body.includes(SECRET),
      `the text did not return: ${world.page.system.body}`);
    assert(world.page.system.sealed.every(s => s.id !== redactionId),
      "the marker was left behind after revealing");
  });

  await check("the stored copy is dropped once it is back in the page", () => {
    assert(!world.sealedPages.has(redactionId),
      "the companion still holds a copy of revealed text");
  });

  await check("the other redaction is untouched", () => {
    assert(world.page.system.sealed.length === 1, "revealing one affected the other");
    assert(!world.page.system.body.includes("Victim found at 02:14"),
      "revealing one also revealed the other");
  });

  describe("only the GM");

  await check("a player can neither redact nor reveal", async () => {
    const playerWorld = makeWorld({isGM: false});
    const id = await redactPassage(playerWorld.page, SECRET, "");
    assert(id === null, "a player redacted a passage");
    assert(playerWorld.page.system.body.includes(SECRET),
      "a player's failed redaction still altered the page");

    const gmWorld = makeWorld();
    const realId = await redactPassage(gmWorld.page, SECRET, "");
    globalThis.game.user = {id: "p1", isGM: false};
    const revealed = await revealPassage(gmWorld.page, realId);
    assert(revealed === false, "a player revealed a sealed passage");
    assert(!gmWorld.page.system.body.includes(SECRET),
      "a player's failed reveal exposed the text");
  });

  await check("redacting text that is not there changes nothing", async () => {
    const fresh = makeWorld();
    const before = fresh.page.system.body;
    const id = await redactPassage(fresh.page, "a phrase that does not appear", "");
    assert(id === null, "redaction claimed success for absent text");
    assert(fresh.page.system.body === before, "the page was modified anyway");
    assert(fresh.created.length === 0, "a companion entry was created needlessly");
  });
}
