import {assert, check, describe} from "./harness.mjs";

const REPORT = "investigation-board.report";
const MODULE_ID = "investigation-board";

/** A stand-in case-file page. */
function reportPage(id, name, system = {}, parent = null) {
  return {
    id, name, type: REPORT, visible: true, parent,
    system: {
      kind: "entry", caseNumber: "", body: "", author: null, createdAt: null,
      sealed: [], sort: 0, ...system
    }
  };
}

/** A stand-in case owning the given pages. */
function journalOf(pages, {assignedTo = null, isOwner = true} = {}) {
  const journal = {
    id: "case1", name: "Ashwood", isOwner,
    getFlag: (scope, key) =>
      (scope === MODULE_ID && key === "assignedTo" ? assignedTo : undefined),
    pages: {
      get: id => pages.find(p => p.id === id),
      find: fn => pages.find(fn),
      filter: fn => pages.filter(fn)
    }
  };
  for ( const p of pages ) p.parent = journal;
  return journal;
}

/**
 * Checks for the case file — the written record beside the board.
 *
 * The one that matters most is the redaction check. Redacted text has to be *absent* from what a
 * player's client holds, not merely hidden by styling, because `visible` is a client-side getter
 * and `gmOnlyFields` only guards writes. Anything less and a player reads the answer from the
 * console.
 */
export default async function testCaseFile() {
  const {default: ReportData} = await import("../scripts/data/report-data.mjs");
  const {getBrief, getFindings, canEditReport} = await import("../scripts/data/case.mjs");
  const {redactionMarkup, REDACTION_TAG} = await import("../scripts/data/redaction.mjs");

  describe("ReportData");

  await check("defaults to a findings page with nothing redacted", () => {
    const r = new ReportData({});
    assert(r.kind === "entry", `kind was ${r.kind}`);
    assert(r.isBrief === false, "a bare page should not be the opening file");
    assert(r.hasRedactions === false, "a new page should have no redactions");
    assert(Array.isArray(r.sealed) && !r.sealed.length, "sealed should default empty");
    assert(r.caseNumber === "", "caseNumber should default empty");
  });

  await check("the opening file carries a case number", () => {
    const r = new ReportData({kind: "brief", caseNumber: "4471-B"});
    assert(r.isBrief === true, "kind brief should read as the opening file");
    assert(r.caseNumber === "4471-B", `caseNumber was ${r.caseNumber}`);
  });

  await check("rejects a kind that is neither", () => {
    let threw = false;
    try { new ReportData({kind: "memo"}, {strict: true}); }
    catch { threw = true; }
    assert(threw, "an unknown kind was accepted");
  });

  // A marker records only that something was removed. If it carried the text, or even a hint of
  // it, putting it on a player's client would defeat the whole mechanism.
  await check("a redaction marker holds no trace of the text", () => {
    const r = new ReportData({
      sealed: [{id: "abc", label: "12 characters", sealedBy: "gm", sealedAt: 1700000000}]
    });
    assert(r.hasRedactions === true, "the redaction was not recorded");
    const marker = r.sealedMarker("abc");
    assert(!!marker, "the marker could not be found by id");
    assert(!("text" in marker) && !("content" in marker) && !("body" in marker),
      `the marker carries content: ${JSON.stringify(marker)}`);
  });

  describe("redaction markup");

  await check("the marker element carries an id and nothing readable", () => {
    const html = redactionMarkup("abc123", "two lines");
    assert(html.includes(`class="${REDACTION_TAG}"`), "missing the redaction class");
    assert(html.includes('data-redaction-id="abc123"'), "missing the id");
    assert(!html.includes("<script"), "markup should not be able to carry script");
  });

  await check("a label is escaped rather than trusted", () => {
    const html = redactionMarkup("id1", '"><script>alert(1)</script>');
    assert(!html.includes("<script>"), `a label broke out of the attribute: ${html}`);
    assert(html.includes("&lt;script&gt;") || html.includes("&quot;"),
      `the label was not escaped: ${html}`);
  });

  describe("reading the file");

  const brief = reportPage("b1", "The Ashwood File",
    {kind: "brief", caseNumber: "4471-B", body: "<p>Opening.</p>", sort: -1});
  const first = reportPage("f1", "Docks", {body: "<p>One.</p>", author: "p1", createdAt: 100, sort: 0});
  const second = reportPage("f2", "Ledger", {body: "<p>Two.</p>", author: "p2", createdAt: 200, sort: 1});
  const journal = journalOf([brief, second, first], {assignedTo: "p1"});

  await check("the opening file is found among the pages", () => {
    assert(getBrief(journal)?.id === "b1", "the opening file was not found");
  });

  await check("findings read in the order they were written", () => {
    const order = getFindings(journal).map(p => p.id);
    assert(order.join() === "f1,f2", `order was ${order.join()}`);
  });

  await check("the opening file is not listed among the findings", () => {
    assert(!getFindings(journal).some(p => p.id === "b1"),
      "the opening file appeared in the findings list");
  });

  describe("who may write what");

  const gm = {id: "gm", isGM: true};
  const owner = {id: "p1", isGM: false};
  const other = {id: "p2", isGM: false};

  await check("the GM may write anything", () => {
    assert(canEditReport(brief, gm) === true, "the GM was refused the opening file");
    assert(canEditReport(second, gm) === true, "the GM was refused someone's finding");
  });

  // Settled in discussion: the opening file belongs to the GM and to the case's own player.
  await check("the opening file belongs to the case's player", () => {
    assert(canEditReport(brief, owner) === true, "the case's player was refused their own file");
    assert(canEditReport(brief, other) === false,
      "another player could rewrite the official opening file");
  });

  // Anyone can add to the file; nobody rewrites someone else's account of it.
  await check("a finding belongs to whoever wrote it", () => {
    assert(canEditReport(first, owner) === true, "an author was refused their own finding");
    assert(canEditReport(first, other) === false, "someone rewrote another player's finding");
    assert(canEditReport(second, other) === true, "the second author was refused their own");
  });

  await check("someone with no access to the case may write nothing", () => {
    const closed = journalOf([reportPage("x", "X", {author: "p1"})], {isOwner: false});
    assert(canEditReport(closed.pages.get("x"), owner) === false,
      "a non-owner of the case could write in its file");
  });
}
