import fs from "node:fs";
import {createRequire} from "node:module";
import {APP, assert, check, describe} from "./harness.mjs";

/**
 * Render every Handlebars part against realistic contexts, using the Handlebars that Foundry
 * itself ships.
 *
 * This is the only thing that catches a scope mistake — `../isGM` where `../../isGM` was meant
 * resolves to nothing, so a control silently never appears, or appears for everyone. A static
 * search for "isGM" sees both spellings as fine, and the board only reveals the difference at
 * runtime with a real user logged in.
 */
export default async function testTemplates() {
  const require = createRequire(`file:///${APP}/package.json`);
  let Handlebars;
  try {
    Handlebars = require("handlebars");
  }
  catch {
    describe("templates");
    await check("Handlebars is available from the Foundry install", () => {
      assert(false, `could not load handlebars from ${APP}`);
    });
    return;
  }

  Handlebars.registerHelper({
    localize: k => (typeof k === "string" ? k : ""),
    eq: (a, b) => a === b,
    selectOptions: () => new Handlebars.SafeString(""),
    concat: (...a) => a.slice(0, -1).join("")
  });

  const root = new URL("../", import.meta.url);
  const render = (file, context) =>
    Handlebars.compile(fs.readFileSync(new URL(file, root), "utf8"))(context);
  const countAction = (html, action) =>
    (html.match(new RegExp(`data-action="${action}"`, "g")) || []).length;

  const sidebarContext = isGM => ({
    isGM,
    groupings: [{value: "all", label: "All", selected: true}],
    groups: [{
      label: "Case Files",
      cases: [
        {id: "c1", name: "Ashwood", active: true, isOwner: true, status: "active",
          statusLabel: "Active", classification: "Homicide", archived: false},
        {id: "c2", name: "Dockside", active: false, isOwner: false, status: "cold",
          statusLabel: "Cold", classification: "", archived: true}
      ]
    }]
  });

  const headerContext = isGM => ({
    isGM,
    hasCase: true,
    canShare: true,
    currentCase: {id: "c1", name: "Ashwood", isOwner: true},
    state: {status: "active", statusLabel: "Active", progress: 68,
      classification: "Homicide", archived: false}
  });

  describe("sidebar.hbs");

  // The delete control sits two `each` levels deep, so its condition has to reach right back to
  // the root context. Getting that depth wrong is invisible until someone logs in.
  await check("only a GM sees a delete control, and then on every row", () => {
    const gm = render("templates/sidebar.hbs", sidebarContext(true));
    const player = render("templates/sidebar.hbs", sidebarContext(false));
    assert(countAction(gm, "deleteCase") === 2,
      `a GM saw ${countAction(gm, "deleteCase")} delete controls, expected one per case`);
    assert(countAction(player, "deleteCase") === 0,
      `a player saw ${countAction(player, "deleteCase")} delete controls`);
  });

  await check("the details control shows only for a case the user owns", () => {
    const gm = render("templates/sidebar.hbs", sidebarContext(true));
    assert(countAction(gm, "configureCase") === 1,
      `expected one, got ${countAction(gm, "configureCase")}`);
  });

  await check("every case is listed, archived ones marked", () => {
    const gm = render("templates/sidebar.hbs", sidebarContext(true));
    assert((gm.match(/ib-case-row/g) || []).length === 2, "not every case was listed");
    assert(gm.includes("archived"), "the archived case was not marked");
  });

  describe("header.hbs");

  await check("only a GM sees the delete control", () => {
    const gm = render("templates/header.hbs", headerContext(true));
    const player = render("templates/header.hbs", headerContext(false));
    assert(countAction(gm, "deleteCase") === 1, "the GM has no delete control");
    assert(countAction(player, "deleteCase") === 0, "a player was offered delete");
  });

  await check("an owner gets archive and an editable progress bar", () => {
    const player = render("templates/header.hbs", headerContext(false));
    assert(countAction(player, "archiveCase") === 1, "no archive control");
    assert(player.includes("ib-progress-input"), "progress is not editable for an owner");
    assert(player.includes("68%"), "the progress value is not shown");
  });

  await check("a non-owner gets a plain progress bar and no archive", () => {
    const context = headerContext(false);
    context.currentCase.isOwner = false;
    const html = render("templates/header.hbs", context);
    assert(!html.includes("ib-progress-input"), "a non-owner was given the progress slider");
    assert(html.includes("ib-progress-fill"), "a non-owner sees no progress at all");
    assert(countAction(html, "archiveCase") === 0, "a non-owner was offered archive");
  });

  describe("case-file.hbs");

  const fileContext = isGM => ({
    isGM,
    caseName: "Ashwood",
    brief: {id: "b1", caseNumber: "4471-B", body: "<p>Opening.</p>", editable: true, redactions: 2},
    findings: [{id: "f1", name: "Docks", body: "<p>One.</p>", byline: "Sam",
      editable: false, deletable: false}],
    canStartBrief: false,
    canAddFinding: true
  });

  // Redacting is the GM's alone, so the control must not be offered to anyone else.
  await check("only a GM is offered the redact control", () => {
    const gm = render("templates/case-file.hbs", fileContext(true));
    const player = render("templates/case-file.hbs", fileContext(false));
    assert(countAction(gm, "redactSelection") === 2,
      `a GM saw ${countAction(gm, "redactSelection")} redact controls, expected one per page`);
    assert(countAction(player, "redactSelection") === 0,
      `a player was offered ${countAction(player, "redactSelection")} redact controls`);
  });

  await check("a player cannot edit or remove someone else's finding", () => {
    const player = render("templates/case-file.hbs", fileContext(false));
    assert(countAction(player, "editFinding") === 0, "a player was offered an edit control");
    assert(countAction(player, "deleteFinding") === 0, "a player was offered a delete control");
  });

  await check("the case number and findings are shown", () => {
    const html = render("templates/case-file.hbs", fileContext(true));
    assert(html.includes("4471-B"), "the case number is missing");
    assert(html.includes("Docks"), "the finding is missing");
    assert(html.includes("Sam"), "the byline is missing");
  });

  await check("an unopened file invites whoever may start it", () => {
    const context = fileContext(false);
    context.brief = null;
    context.canStartBrief = true;
    const html = render("templates/case-file.hbs", context);
    assert(countAction(html, "editBrief") === 1, "no way to start the file");
  });

  describe("every part compiles and renders");

  const parts = [
    ["templates/toolbar.hbs", {hasCase: true, dismissed: [], linkMode: false,
      filterOpen: false, filterActive: false}],
    ["templates/tray.hbs", {isGM: true, trayOpen: true, dismissed: [
      {id: "z", name: "Ruled out", image: null, template: "sticky", dismissedLabel: "Set aside"}]}],
    ["templates/filter.hbs", {filterOpen: true, filter: {text: ""}, categories: [],
      reliabilities: [], authors: [], filterSummary: ""}],
    ["templates/inspector.hbs", {clue: {id: "a", name: "Watch", category: "physical",
      reliability: "verified", editable: true, notes: []}, connections: [],
      categories: [], reliabilities: []}],
    ["templates/board.hbs", {hasCase: true}],
    ["templates/dialog/clue-dialog.hbs", {templates: [], pinColors: [], categories: [],
      reliabilities: [], showsImage: true, showsBody: true, canUpload: true, clue: {}}],
    ["templates/dialog/case-config.hbs", {state: {progress: 0}, statuses: [], classifications: []}],
    ["templates/dialog/share.hbs", {players: [], needsGM: false, gmOnline: true}],
    ["templates/dialog/dialog-footer.hbs", {buttons: [{type: "submit", label: "X"}]}],
    ["templates/page/clue-view.hbs", {name: "X", clue: {}, categoryChoices: {}, reliabilityChoices: {}}],
    ["templates/page/clue-edit.hbs", {rootId: "r", name: "X", clue: {}}],
    ["templates/page/connection-view.hbs", {name: "X", connection: {}}],
    ["templates/page/connection-edit.hbs", {rootId: "r", connection: {}}],
    ["templates/page/report-view.hbs", {name: "X", report: {}, enrichedBody: "<p>x</p>"}],
    ["templates/page/report-edit.hbs", {rootId: "r", name: "X", report: {}}],
    ["templates/dialog/report.hbs", {isBrief: true, caseName: "X", name: "", caseNumber: "",
      body: "", redactions: 0}],
    ["templates/case-file.hbs", {isGM: false, caseName: "X", brief: null, findings: [],
      canStartBrief: true, canAddFinding: true}]
  ];

  for ( const [file, context] of parts ) {
    await check(file, () => {
      const html = render(file, context);
      assert(html.trim().length > 0, "rendered nothing");
    });
  }
}
