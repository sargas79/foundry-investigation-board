import {MODULE_ID, PAGE_TYPES, modulePath} from "./constants.mjs";
import ClueData from "./data/clue-data.mjs";
import ConnectionData from "./data/connection-data.mjs";
import InvestigationBoard from "./apps/investigation-board.mjs";
import {CluePageSheet, ConnectionPageSheet} from "./apps/clue-page-sheet.mjs";
import {registerKeybindings, registerSettings} from "./settings.mjs";

/**
 * The shared board instance. Created lazily so the window survives across case switches.
 * @type {InvestigationBoard|null}
 */
let board = null;

/**
 * Open the Investigation Board, optionally on a specific case.
 * @param {string} [caseId]   JournalEntry id of a case to display.
 * @returns {Promise<InvestigationBoard>}
 */
async function openBoard(caseId) {
  board ??= new InvestigationBoard();
  return board.open(caseId);
}

/* -------------------------------------------- */
/*  Initialization                              */
/* -------------------------------------------- */

Hooks.once("init", () => {
  // Data models for our JournalEntryPage sub-types.
  Object.assign(CONFIG.JournalEntryPage.dataModels, {
    [PAGE_TYPES.CLUE]: ClueData,
    [PAGE_TYPES.CONNECTION]: ConnectionData
  });

  // Sheets, so these pages can still be opened from the journal sidebar.
  const {DocumentSheetConfig} = foundry.applications.apps;
  const JournalEntryPage = getDocumentClass("JournalEntryPage");
  DocumentSheetConfig.registerSheet(JournalEntryPage, MODULE_ID, CluePageSheet, {
    types: [PAGE_TYPES.CLUE],
    makeDefault: true,
    label: "INVESTIGATION_BOARD.CluePageSheet"
  });
  DocumentSheetConfig.registerSheet(JournalEntryPage, MODULE_ID, ConnectionPageSheet, {
    types: [PAGE_TYPES.CONNECTION],
    makeDefault: true,
    label: "INVESTIGATION_BOARD.ConnectionPageSheet"
  });

  registerFonts();
  registerSettings();
  registerKeybindings();

  foundry.applications.handlebars.loadTemplates([
    modulePath("templates/sidebar.hbs"),
    modulePath("templates/header.hbs"),
    modulePath("templates/board.hbs"),
    modulePath("templates/toolbar.hbs"),
    modulePath("templates/inspector.hbs")
  ]);

  game.modules.get(MODULE_ID).api = {
    open: openBoard,
    InvestigationBoard,
    ClueData,
    ConnectionData
  };
});

/* -------------------------------------------- */

Hooks.once("ready", () => {
  console.log(`${MODULE_ID} | Investigation Board ready`);
});

/* -------------------------------------------- */
/*  Document synchronisation                    */
/* -------------------------------------------- */

/**
 * Keep an open board in step with the documents behind it.
 *
 * These fire on every client, which is what makes the board collaborative: one player moving a clue
 * writes one document update, and everyone else's board patches that single card in place. A full
 * re-render here would interrupt whatever the other players were doing.
 */
Hooks.on("createJournalEntryPage", page => board?.onPageChange(page, "upsert"));
Hooks.on("updateJournalEntryPage", page => board?.onPageChange(page, "upsert"));
Hooks.on("deleteJournalEntryPage", page => board?.onPageChange(page, "delete"));

Hooks.on("updateJournalEntry", journal => board?.onCaseChange(journal, "update"));
Hooks.on("deleteJournalEntry", journal => board?.onCaseChange(journal, "delete"));
Hooks.on("createJournalEntry", journal => board?.onCaseChange(journal, "update"));

/* -------------------------------------------- */
/*  Fonts                                       */
/* -------------------------------------------- */

/**
 * Expose the bundled fonts to Foundry's font picker.
 *
 * The board's own CSS loads them via `styles/fonts.css` regardless; registering them here just
 * means players can also pick them in a journal or drawing text editor.
 */
function registerFonts() {
  const fontPath = name => modulePath(`assets/fonts/${name}`);
  Object.assign(CONFIG.fontDefinitions, {
    Caveat: {
      editor: true,
      fonts: [
        {urls: [fontPath("caveat-latin.woff2")]},
        {urls: [fontPath("caveat-latin.woff2")], weight: "700"}
      ]
    },
    "Courier Prime": {
      editor: true,
      fonts: [
        {urls: [fontPath("courier-prime-400-latin.woff2")]},
        {urls: [fontPath("courier-prime-700-latin.woff2")], weight: "700"},
        {urls: [fontPath("courier-prime-400-italic-latin.woff2")], style: "italic"}
      ]
    }
  });
}

/* -------------------------------------------- */
/*  Scene Controls                              */
/* -------------------------------------------- */

/**
 * Add a button to the token scene controls that opens the board.
 *
 * V13+ passes controls and their tools as records keyed by name. A tool with no onChange throws
 * inside core, so one is always supplied.
 */
Hooks.on("getSceneControlButtons", controls => {
  const tokens = controls.tokens;
  if ( !tokens ) return;
  tokens.tools[MODULE_ID] = {
    name: MODULE_ID,
    title: "INVESTIGATION_BOARD.SceneControl",
    icon: "fa-solid fa-thumbtack",
    order: Object.keys(tokens.tools).length,
    button: true,
    visible: true,
    onChange: () => openBoard()
  };
});
