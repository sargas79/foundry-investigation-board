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
