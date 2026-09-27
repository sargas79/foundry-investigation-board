import {assert, check, describe} from "./harness.mjs";

/**
 * Checks for filing the module's journals in their own folder (#80).
 *
 * The folder is found by flag rather than name, only a GM may make it, and where a journal is filed
 * must never stop it being created — those are the rules worth pinning down.
 */
export default async function testFolders() {
  const {
    casesFolderData, casesFolderId, ensureCasesFolder, findCasesFolder, inCasesFolder,
    isModuleJournal, prepareCasesFolder, unfiledJournals
  } = await import("../scripts/data/folders.mjs");

  const MODULE_ID = "sargas-investigation-board";
  const folder = (id, type, flagged) => ({
    id, type, getFlag: (scope, key) => (flagged && scope === MODULE_ID && key === "casesFolder") || undefined
  });

  /** Swap in a world for the length of one check. */
  const withWorld = async ({folders = [], setting = true, filed = false, canCreate = true, activeGM = true,
    journals = [], onCreate, onUpdate, onSet}, fn) => {
    const previous = {...globalThis.game};
    const previousClass = globalThis.getDocumentClass;
    globalThis.game.folders = folders;
    globalThis.game.journal = journals;
    globalThis.game.user = {id: "u"};
    globalThis.game.users = {activeGM: activeGM ? {isSelf: true} : null};
    globalThis.game.settings = {
      get: (_, key) => (key === "casesFolder" ? setting : filed),
      set: async (_, key, value) => onSet?.(key, value)
    };
    globalThis.getDocumentClass = name => ({
      Folder: {
        canUserCreate: () => canCreate,
        create: async data => {
          const made = {...folder("new", data.type, true), data};
          folders.push(made);
          return onCreate ? onCreate(data, made) : made;
        }
      },
      JournalEntry: {updateDocuments: async updates => onUpdate?.(updates)}
    })[name] ?? previousClass(name);
    try { await fn(); }
    finally {
      globalThis.game = previous;
      globalThis.getDocumentClass = previousClass;
    }
  };

  describe("findCasesFolder");

  await check("finds the flagged journal folder, whatever it has been renamed to", () => {
    const found = findCasesFolder([
      folder("a", "JournalEntry", false),
      folder("b", "Actor", true),
      folder("c", "JournalEntry", true)
    ]);
    assert(found?.id === "c", `found ${found?.id}`);
  });

  await check("finds nothing in a world without one", () => {
    assert(findCasesFolder([folder("a", "JournalEntry", false)]) === null, "found a folder");
    assert(findCasesFolder(undefined) === null, "found a folder in no collection");
  });

  describe("casesFolderData");

  await check("is a flagged, alphabetical journal folder", () => {
    const data = casesFolderData();
    assert(data.type === "JournalEntry", `type was ${data.type}`);
    assert(data.sorting === "a", `sorting was ${data.sorting}`);
    assert(data.flags[MODULE_ID].casesFolder === true, "the folder is not flagged");
    assert(data.name === "INVESTIGATION_BOARD.CasesFolderName", `name was ${data.name}`);
  });

  describe("casesFolderId");

  await check("uses the folder that exists", async () => {
    await withWorld({folders: [folder("c", "JournalEntry", true)]}, async () => {
      assert(await casesFolderId() === "c", "did not use the existing folder");
    });
  });

  await check("makes the folder for a user allowed to", async () => {
    await withWorld({}, async () => {
      assert(await casesFolderId() === "new", "no folder was made");
    });
  });

  // Folders need an Assistant GM; a Trusted Player making a case must still get one.
  await check("leaves the journal at the root for a user who may not make folders", async () => {
    await withWorld({canCreate: false}, async () => {
      assert(await casesFolderId() === null, "a folder was used that could not exist");
    });
  });

  await check("leaves the journal at the root when the GM has switched filing off", async () => {
    await withWorld({setting: false, folders: [folder("c", "JournalEntry", true)]}, async () => {
      assert(await casesFolderId() === null, "filed despite the setting");
    });
  });

  await check("leaves the journal at the root if the folder cannot be made", async () => {
    const warn = console.warn;
    console.warn = () => {};
    try {
      await withWorld({onCreate: () => { throw new Error("refused"); }}, async () => {
        assert(await casesFolderId() === null, "a failed folder should not be used");
      });
    }
    finally { console.warn = warn; }
  });

  await check("makes one folder when two journals are created at once", async () => {
    let made = 0;
    await withWorld({onCreate: (_, f) => { made++; return f; }}, async () => {
      const [a, b] = await Promise.all([ensureCasesFolder(), ensureCasesFolder()]);
      assert(made === 1, `made ${made} folders`);
      assert(a === b, "the two journals were given different folders");
    });
  });

  describe("inCasesFolder");

  await check("adds the folder and keeps the rest of the data", async () => {
    await withWorld({folders: [folder("c", "JournalEntry", true)]}, async () => {
      const data = await inCasesFolder({name: "X", flags: {a: 1}});
      assert(data.folder === "c", `folder was ${data.folder}`);
      assert(data.name === "X" && data.flags.a === 1, "the journal's data was lost");
    });
  });

  describe("unfiledJournals");

  const journal = (id, flags, folderId = null) => ({id, _source: {folder: folderId, flags: {[MODULE_ID]: flags}}});

  await check("recognises cases, handouts and sealed entries", () => {
    assert(isModuleJournal(journal("a", {isCase: true})._source), "a case was missed");
    assert(isModuleJournal(journal("b", {isHandout: true})._source), "a handout was missed");
    assert(isModuleJournal(journal("c", {sealedFor: "a"})._source), "a sealed entry was missed");
    assert(!isModuleJournal({flags: {}}), "a GM's own journal was taken");
  });

  // A journal the GM has filed themselves is theirs to keep where they put it.
  await check("takes only module journals still at the root", () => {
    const found = unfiledJournals([
      journal("a", {isCase: true}),
      journal("b", {isCase: true}, "gmFolder"),
      journal("c", {}),
      journal("d", {isHandout: true})
    ]).map(j => j.id);
    assert(found.join() === "a,d", `took ${found.join()}`);
  });

  describe("prepareCasesFolder");

  await check("files the world's existing journals once, then remembers it has", async () => {
    let updates = null;
    let marked = false;
    await withWorld({
      journals: [journal("a", {isCase: true}), journal("b", {})],
      onUpdate: u => { updates = u; },
      onSet: (key, value) => { marked = key === "casesFolderFiled" && value; }
    }, prepareCasesFolder);
    assert(JSON.stringify(updates) === JSON.stringify([{_id: "a", folder: "new"}]),
      `updated ${JSON.stringify(updates)}`);
    assert(marked, "the world was not marked as filed");
  });

  await check("does not refile a world already filed", async () => {
    let updated = false;
    await withWorld({filed: true, journals: [journal("a", {isCase: true})], onUpdate: () => { updated = true; }},
      prepareCasesFolder);
    assert(!updated, "a case the GM moved out was moved back");
  });

  await check("runs only on the active GM's client", async () => {
    let made = false;
    await withWorld({activeGM: false, onCreate: (_, f) => { made = true; return f; }}, prepareCasesFolder);
    assert(!made, "a second client made a folder");
  });
}
