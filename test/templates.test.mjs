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

  describe("sidebar.hbs — documents");

  const documentsContext = extra => ({
    isGM: false,
    documentsTab: true,
    canManageHandouts: false,
    canPin: false,
    handoutCount: 2,
    handouts: [
      {id: "h1", name: "Coroner Report", icon: "fa-solid fa-cross",
        kindLabel: "Death Record", subLabel: "With Mara", shared: true,
        shareTooltip: "With Mara"},
      {id: "h2", name: "Ashford Badge", icon: "fa-solid fa-id-badge",
        kindLabel: "Company Badge", subLabel: "Not handed out yet", shared: false,
        shareTooltip: "Not handed out yet"}
    ],
    ...extra
  });

  // Writing and handing over documents is the GM's alone. A player offered an edit or a hand-over
  // control would be offered an action the server will refuse, and a delete control would suggest
  // they could take a document out of the campaign.
  await check("only a GM is offered the writing and hand-over controls", () => {
    const gm = render("templates/sidebar.hbs",
      documentsContext({isGM: true, canManageHandouts: true, hasRowActions: true}));
    const player = render("templates/sidebar.hbs", documentsContext());

    for ( const action of ["shareHandout", "editHandout", "deleteHandout"] ) {
      assert(countAction(gm, action) === 2,
        `a GM saw ${countAction(gm, action)} ${action} controls, expected one per document`);
      assert(countAction(player, action) === 0,
        `a player was offered ${countAction(player, action)} ${action} controls`);
    }
    assert(countAction(gm, "createHandout") === 1, "the GM has no way to write a document");
    assert(countAction(player, "createHandout") === 0, "a player was offered a new document");
  });

  // A player's whole reason for holding a document is to be able to put it on the board, so the
  // control is theirs too — but only where there is a case open to pin it to.
  await check("pinning is offered to anyone, and only with a writable case open", () => {
    const withCase = render("templates/sidebar.hbs",
      documentsContext({canPin: true, hasRowActions: true}));
    const without = render("templates/sidebar.hbs", documentsContext());
    assert(countAction(withCase, "pinHandout") === 2,
      `expected one pin control per document, got ${countAction(withCase, "pinHandout")}`);
    assert(countAction(without, "pinHandout") === 0,
      "a pin control was offered with no case open to pin to");
  });

  // An overlay with nothing in it still paints its gradient across the row on hover, so the
  // wrapper has to go too — not just the controls inside it.
  await check("a viewer with no controls gets no overlay at all", () => {
    const player = render("templates/sidebar.hbs", documentsContext());
    assert(!player.includes("ib-handout-actions"),
      "an empty actions overlay was rendered for a player with no case open");
    const withPin = render("templates/sidebar.hbs",
      documentsContext({canPin: true, hasRowActions: true}));
    assert((withPin.match(/ib-handout-actions/g) || []).length === 2,
      "the overlay is missing where there is a control to put in it");
  });

  await check("every document is listed, the ones handed out marked", () => {
    const html = render("templates/sidebar.hbs", documentsContext());
    assert(countAction(html, "openHandout") === 2, "not every document was listed");
    assert(html.includes("Coroner Report") && html.includes("Ashford Badge"),
      "a document name is missing");
    assert(/ib-handout-row shared/.test(html), "the document in a player's hands was not marked");
  });

  // The two lists share the sidebar; picking one must not show both or neither.
  await check("the tabs show one list at a time", () => {
    const documents = render("templates/sidebar.hbs", documentsContext());
    const cases = render("templates/sidebar.hbs", sidebarContext(true));
    assert(!documents.includes("ib-case-list"), "the case list showed on the documents tab");
    assert(documents.includes("ib-handout-list"), "the documents tab showed no documents");
    assert(cases.includes("ib-case-list"), "the cases tab showed no cases");
    assert(!cases.includes("ib-handout-list"), "the documents list showed on the cases tab");
  });

  await check("an empty list says something different to a GM and to a player", () => {
    const gm = render("templates/sidebar.hbs",
      documentsContext({handouts: [], handoutCount: 0, isGM: true, canManageHandouts: true,
        hasRowActions: true}));
    const player = render("templates/sidebar.hbs",
      documentsContext({handouts: [], handoutCount: 0}));
    assert(gm.includes("NoHandoutsGM"), "the GM was not told how to start");
    assert(player.includes("INVESTIGATION_BOARD.NoHandouts") && !player.includes("NoHandoutsGM"),
      "a player was told to write documents");
  });

  describe("handout-view.hbs");

  const handoutContext = extra => ({
    name: "Coroner Report",
    kindLabel: "Death Record",
    icon: "fa-solid fa-cross",
    portrait: false,
    handout: {kind: "death", issuer: "City Coroner Office", reference: "4471-B",
      dateline: "14th of Brume", image: null},
    rows: [{label: "Deceased", value: "A. Vance"}, {label: "Cause", value: "Exsanguination"}],
    enrichedBody: "<p>Found at the waterline.</p>",
    ...extra
  });

  await check("the document prints its head, its particulars and its text", () => {
    const html = render("templates/page/handout-view.hbs", handoutContext());
    assert(html.includes("City Coroner Office"), "the issuer is missing");
    assert(html.includes("4471-B"), "the reference is missing");
    assert(html.includes("A. Vance") && html.includes("Exsanguination"), "a particular is missing");
    assert(html.includes("Found at the waterline."), "the text is missing");
    assert(html.includes("14th of Brume"), "the dateline is missing");
  });

  // The image is a photograph of a person on some kinds and a scan of the paper on others; showing
  // it in the wrong place is the difference between an ID card and a full-width picture.
  await check("the image lands where the kind puts it", () => {
    const badge = render("templates/page/handout-view.hbs",
      handoutContext({portrait: true, handout: {kind: "badge", image: "a.webp"}}));
    const record = render("templates/page/handout-view.hbs",
      handoutContext({portrait: false, handout: {kind: "death", image: "a.webp"}}));
    assert(badge.includes("ib-handout-portrait") && !badge.includes("ib-handout-scan"),
      "a badge photograph was printed as a full-width scan");
    assert(record.includes("ib-handout-scan") && !record.includes("ib-handout-portrait"),
      "a record scan was printed as a portrait");
  });

  await check("a portrait kind with no photograph still reads as a card", () => {
    const html = render("templates/page/handout-view.hbs",
      handoutContext({portrait: true, handout: {kind: "identity", image: null}}));
    assert(html.includes("ib-handout-nophoto"), "an ID with no photo left an empty frame");
  });

  await check("a bare document prints without empty rules", () => {
    const html = render("templates/page/handout-view.hbs", handoutContext({
      rows: [], enrichedBody: "",
      handout: {kind: "document", issuer: "", reference: "", dateline: "", image: null}
    }));
    assert(!html.includes("ib-handout-rows"), "an empty particulars list was still drawn");
    assert(!html.includes("ib-handout-foot"), "an empty dateline still drew a footer");
    assert(html.includes("Coroner Report"), "the document lost its name");
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

  describe("toolbar.hbs");

  const toolbarContext = extra => ({
    hasCase: true, dismissed: [], linkMode: false, filterOpen: false, filterActive: false,
    handActive: true, ...extra
  });

  // The way out of the linking tool. Without it the only way back to a plain pointer is Escape,
  // which is not discoverable from a toolbar.
  await check("the hand is offered whenever a case is open", () => {
    const html = render("templates/toolbar.hbs", toolbarContext());
    assert(countAction(html, "useHand") === 1,
      `expected one hand control, got ${countAction(html, "useHand")}`);
    assert(!html.includes('data-action="useHand" disabled'), "the hand was disabled with a case open");
  });

  await check("the hand reads as engaged only when no other tool is", () => {
    const resting = render("templates/toolbar.hbs", toolbarContext());
    const linking = render("templates/toolbar.hbs", toolbarContext({linkMode: true, handActive: false}));
    // The pressed state is what tells a screen reader which tool is in use, so it has to follow
    // the class rather than being spelled independently.
    assert(/ib-tool active[\s\S]*?data-action="useHand"[\s\S]*?aria-pressed="true"/.test(resting),
      "the resting hand is not shown as the engaged tool");
    assert(/data-action="useHand"[\s\S]*?aria-pressed="false"/.test(linking),
      "the hand still reads as engaged while the linking tool is on");
    assert(/ib-tool active[\s\S]*?data-action="drawConnection"/.test(linking),
      "the linking tool is not shown as engaged");
  });

  await check("with no case open every tool is disabled, the hand included", () => {
    const html = render("templates/toolbar.hbs", toolbarContext({hasCase: false, handActive: false}));
    const buttons = html.match(/<button[\s\S]*?>/g) ?? [];
    const enabled = buttons.filter(b => !b.includes("disabled") && !b.includes("importCase"));
    assert(enabled.length === 0, `these stayed enabled without a case: ${enabled.join(" ")}`);
  });

  describe("page sheets do not duplicate core's fields");

  // A page sheet that lists `super.EDIT_PARTS.header` already has core's `page-header.hbs` in the
  // form, and that part renders the page's name field. A second input with the same name makes
  // `form.elements.namedItem("name")` a RadioNodeList, which FormDataExtended reads as an *array*
  // of every matching field rather than a string — so saving stored "Old,New" and the title
  // doubled in length on every edit. Nothing about the rendered form looks wrong, and no other
  // check would catch it, so it is asserted directly against the source.
  await check("no page edit template declares its own name field", () => {
    const offenders = [];
    for ( const file of fs.readdirSync(new URL("templates/page/", root)) ) {
      if ( !file.endsWith("-edit.hbs") ) continue;
      const text = fs.readFileSync(new URL(`templates/page/${file}`, root), "utf8");
      if ( /name=("|')name\1/.test(text) ) offenders.push(file);
    }
    assert(offenders.length === 0,
      `these would double the page title on every save: ${offenders.join(", ")}`);
  });

  describe("every part compiles and renders");

  const parts = [
    ["templates/toolbar.hbs", {hasCase: true, dismissed: [], linkMode: false,
      filterOpen: false, filterActive: false, handActive: true}],
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
      canStartBrief: true, canAddFinding: true}],
    ["templates/dialog/handout.hbs", {name: "", handout: {rows: []}, rows: [], kinds: [],
      imageHint: "X", canUpload: true}],
    ["templates/dialog/handout-share.hbs", {players: [], wholeParty: false}],
    ["templates/page/handout-view.hbs", {name: "X", handout: {kind: "document"}, rows: [],
      kindLabel: "Document", icon: "fa-solid fa-file-lines", enrichedBody: ""}],
    ["templates/page/handout-edit.hbs", {rootId: "r", name: "X", handout: {rows: []}}]
  ];

  for ( const [file, context] of parts ) {
    await check(file, () => {
      const html = render(file, context);
      assert(html.trim().length > 0, "rendered nothing");
    });
  }
}
