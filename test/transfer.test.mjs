import {assert, check, describe} from "./harness.mjs";

const CLUE = "investigation-board.clue";
const CONN = "investigation-board.connection";

/** A stand-in case holding the given pages. */
function journalOf(name, pages, flags = {}) {
  return {
    name,
    pages: {filter: fn => pages.filter(fn)},
    getFlag: (scope, key) => (scope === "investigation-board" ? flags[key] : undefined)
  };
}

const cluePage = (id, name, system = {}) => ({
  id, name, type: CLUE,
  system: {
    template: "polaroid", image: null, body: "", pinColor: "red", redacted: false,
    category: "other", reliability: "unverified", x: 0, y: 0, rotation: 0, width: 200,
    z: 0, linkedUuid: null, notes: [], dismissed: false, ...system
  }
});

const connPage = (id, from, to, system = {}) => ({
  id, type: CONN,
  system: {from, to, color: "red", style: "solid", label: "", ...system}
});

/**
 * Checks for moving a case between worlds.
 *
 * The delicate part is that connections refer to clues by *index* in the file rather than by id,
 * because ids are reassigned on import — a mistake there would silently produce a board with
 * strings joining the wrong clues.
 */
export default async function testTransfer() {
  const {exportCase, validateExport, buildImport, exportFilename, EXPORT_FORMAT} =
    await import("../scripts/data/transfer.mjs");

  describe("exportCase");

  const journal = journalOf("The Ashwood Murders", [
    cluePage("a", "Mara Vale", {x: 80, y: 60, linkedUuid: "Actor.xyz"}),
    cluePage("b", "Forensic Report", {x: 400, y: 40, body: "<p>0.82</p>"}),
    cluePage("z", "Ruled out", {dismissed: true}),
    connPage("s1", "a", "b", {label: "same night"}),
    connPage("s2", "a", "missing")
  ], {status: "cold", progress: 40, classification: "Homicide"});

  const exported = exportCase(journal);

  await check("carries the case's own details", () => {
    assert(exported.module === "investigation-board", "module not stamped");
    assert(exported.format === EXPORT_FORMAT, "format not stamped");
    assert(exported.name === "The Ashwood Murders", `name was ${exported.name}`);
    assert(exported.status === "cold", `status was ${exported.status}`);
    assert(exported.progress === 40, `progress was ${exported.progress}`);
    assert(exported.classification === "Homicide", "classification missing");
  });

  // The tray is part of the case's history, so discarded clues travel too.
  await check("includes dismissed clues", () => {
    assert(exported.clues.length === 3, `exported ${exported.clues.length} clues`);
    assert(exported.clues.some(c => c.dismissed), "the discarded clue was dropped");
  });

  // A uuid points at a document that will not exist in the destination world.
  await check("strips links to documents in the source world", () => {
    assert(exported.clues.every(c => c.linkedUuid === null),
      "a linkedUuid survived the export");
  });

  await check("refers to clues by index, and drops strings with a missing end", () => {
    assert(exported.connections.length === 1, `exported ${exported.connections.length} strings`);
    const [string] = exported.connections;
    assert(string.from === 0 && string.to === 1, `string joined ${string.from} and ${string.to}`);
    assert(string.label === "same night", "the label was lost");
  });

  describe("the case file in transit");

  const withFile = journalOf("Ashwood", [
    cluePage("a", "Mara Vale"),
    {id: "b1", name: "The File", type: "investigation-board.report", system: {
      kind: "brief", caseNumber: "4471-B", body: "<p>Opening. <span>REDACTED</span></p>",
      sort: -1, sealed: [{id: "s1", label: "a name", sealedBy: "gm", sealedAt: 1}]
    }},
    {id: "f1", name: "Docks", type: "investigation-board.report", system: {
      kind: "entry", caseNumber: "", body: "<p>Found it.</p>", sort: 0, sealed: []
    }}
  ], {});

  const fileExport = exportCase(withFile);

  await check("the opening file and the findings travel", () => {
    assert(fileExport.reports?.length === 2, `exported ${fileExport.reports?.length} pages`);
    const brief = fileExport.reports.find(r => r.kind === "brief");
    assert(brief?.caseNumber === "4471-B", "the case number was lost");
    assert(fileExport.reports.some(r => r.name === "Docks"), "a finding was lost");
  });

  // The markers stay so the bars still read as redactions, but nothing is behind them — the text
  // lives in a GM-only document and putting it in a portable file would defeat the point.
  await check("redaction markers travel but carry nothing", () => {
    const brief = fileExport.reports.find(r => r.kind === "brief");
    assert(brief.sealed.length === 1, "the marker was dropped");
    assert(brief.sealed[0].id === "s1", "the marker id was lost");
    const serialised = JSON.stringify(fileExport);
    assert(!serialised.includes("sealedBy"), "who redacted it leaked into the export");
    assert(!serialised.includes("sealedAt"), "when it was redacted leaked into the export");
  });

  await check("importing rebuilds the file, crediting the importer", () => {
    const built = buildImport(fileExport, "newplayer");
    const reports = built.pages.filter(p => p.type === "investigation-board.report");
    assert(reports.length === 2, `built ${reports.length} case-file pages`);
    const brief = reports.find(p => p.system.kind === "brief");
    assert(brief.system.caseNumber === "4471-B", "the case number did not survive");
    assert(brief.system.author === "newplayer", "authorship was not reassigned");
    assert(brief.system.sealed.length === 1, "the marker did not survive");
  });

  await check("a file with no case-file pages imports cleanly", () => {
    const built = buildImport({...fileExport, reports: undefined}, "p");
    assert(built.pages.every(p => p.type !== "investigation-board.report"),
      "case-file pages appeared from nowhere");
  });

  describe("validateExport");

  await check("accepts its own output", () => {
    assert(validateExport(exported).ok === true, "a valid export was rejected");
  });

  await check("rejects anything that is not one of ours", () => {
    assert(validateExport(null).ok === false, "null was accepted");
    assert(validateExport("nope").ok === false, "a string was accepted");
    assert(validateExport({module: "something-else", format: 1, clues: []}).ok === false,
      "another module's file was accepted");
    assert(validateExport({module: "investigation-board", format: 1}).ok === false,
      "a file with no clues array was accepted");
  });

  // Better to refuse than to silently drop fields a newer version added.
  await check("refuses a file from a newer version", () => {
    const result = validateExport({...exported, format: EXPORT_FORMAT + 1});
    assert(result.ok === false, "a newer format was accepted");
    assert(result.reason.includes("ImportNewerFormat"), `reason was ${result.reason}`);
  });

  describe("buildImport");

  const built = buildImport(exported, "player1");

  await check("gives the case to the importing user", () => {
    assert(built.journal.ownership.player1 === CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER,
      "the importer does not own the imported case");
    assert(built.journal.flags["investigation-board"].isCase === true, "not flagged as a case");
    assert(built.journal.flags["investigation-board"].status === "cold", "status was not carried");
  });

  // The crux: strings must end up joining the same two clues they did before.
  await check("rebuilds strings against the newly assigned clue ids", () => {
    const clues = built.pages.filter(p => p.type === CLUE);
    const strings = built.pages.filter(p => p.type === CONN);
    assert(clues.length === 3, `built ${clues.length} clues`);
    assert(strings.length === 1, `built ${strings.length} strings`);

    const byId = new Map(clues.map(c => [c._id, c.name]));
    const [string] = strings;
    assert(byId.get(string.system.from) === "Mara Vale",
      `string starts at ${byId.get(string.system.from)}`);
    assert(byId.get(string.system.to) === "Forensic Report",
      `string ends at ${byId.get(string.system.to)}`);
  });

  await check("gives every clue a distinct id", () => {
    const ids = built.pages.filter(p => p.type === CLUE).map(p => p._id);
    assert(new Set(ids).size === ids.length, "two clues were given the same id");
  });

  await check("falls back for a case or clue with no name", () => {
    const result = buildImport({...exported, name: "  ", clues: [{name: ""}]}, "p");
    assert(result.journal.name.length > 0, "an empty case name was allowed through");
    assert(result.pages[0].name.length > 0, "an empty clue name was allowed through");
  });

  await check("ignores a string pointing outside the file", () => {
    const result = buildImport({...exported, connections: [{from: 0, to: 99}]}, "p");
    assert(result.pages.filter(p => p.type === CONN).length === 0,
      "a string to a nonexistent clue was built");
  });

  describe("exportFilename");

  await check("makes a readable filename from the case name", () => {
    assert(exportFilename({name: "The Ashwood Murders"}) === "case-the-ashwood-murders.json",
      `got ${exportFilename({name: "The Ashwood Murders"})}`);
    assert(exportFilename({name: "  !!  "}) === "case-untitled.json",
      `got ${exportFilename({name: "  !!  "})}`);
  });
}
