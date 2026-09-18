import {MODULE_ID, PAGE_TYPES, modulePath} from "./constants.mjs";
import {canDeleteCase, canDeletePage} from "./data/case.mjs";
import {CREATE_CASE_QUERY, handleCreateCaseQuery} from "./data/case-create.mjs";
import {SHARE_QUERY, handleShareQuery} from "./data/sharing.mjs";
import {receivePresence} from "./presence.mjs";
import ClueData from "./data/clue-data.mjs";
import ConnectionData from "./data/connection-data.mjs";
import ReportData from "./data/report-data.mjs";
import InvestigationBoard from "./apps/investigation-board.mjs";
import {CluePageSheet, ConnectionPageSheet, ReportPageSheet} from "./apps/clue-page-sheet.mjs";
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
    [PAGE_TYPES.CONNECTION]: ConnectionData,
    [PAGE_TYPES.REPORT]: ReportData
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
  DocumentSheetConfig.registerSheet(JournalEntryPage, MODULE_ID, ReportPageSheet, {
    types: [PAGE_TYPES.REPORT],
    makeDefault: true,
    label: "INVESTIGATION_BOARD.ReportPageSheet"
  });

  registerFonts();
  registerSettings();
  registerKeybindings();

  // A player without JOURNAL_CREATE asks a GM's client to make the case for them.
  CONFIG.queries[CREATE_CASE_QUERY] = handleCreateCaseQuery;
  // Only a GM may change a document's ownership, so sharing is relayed the same way.
  CONFIG.queries[SHARE_QUERY] = handleShareQuery;

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
  // Presence travels over the socket: it is momentary, and writing it would put a database
  // round-trip in the middle of every drag.
  game.socket.on(`module.${MODULE_ID}`, receivePresence);
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
/**
 * Only the GM may destroy a clue; players set clues aside instead.
 *
 * Connections are deliberately *not* guarded — unlinking two clues is an ordinary player action,
 * and the clue documents themselves are what carry the case's content.
 *
 * This runs on the client attempting the delete, so it stops every path through the UI and any
 * accident. It cannot stop a player who deliberately calls the API from the console: Foundry's
 * permission model grants an Owner deletion rights, and taking those away would mean relaying
 * every clue write through a GM, which would break playing with the GM offline. That trade is
 * documented in the README.
 */
Hooks.on("preDeleteJournalEntryPage", page => {
  if ( canDeletePage(page, game.user) ) return true;
  ui.notifications.warn("INVESTIGATION_BOARD.NOTIFY.DeleteIsGMOnly", {localize: true});
  return false;
});

/**
 * The same rule for whole cases: players archive, only the GM deletes.
 *
 * Foundry grants an Owner delete rights on a JournalEntry, so without this a player could destroy
 * a shared case from the journal sidebar with one click and no undo.
 */
Hooks.on("preDeleteJournalEntry", journal => {
  if ( canDeleteCase(journal, game.user) ) return true;
  ui.notifications.warn("INVESTIGATION_BOARD.NOTIFY.CaseDeleteIsGMOnly", {localize: true});
  return false;
});

/**
 * Report rather than swallow a failure inside a hook.
 *
 * These handlers are async but hooks do not await them, so without this a rejection surfaces only
 * as an unhandled promise and the board is left half-updated with no clue why.
 * @param {Promise<unknown>|undefined} promise
 */
function guard(promise) {
  promise?.catch(error => console.error(`${MODULE_ID} | board update failed`, error));
}

Hooks.on("createJournalEntryPage", page => guard(board?.onPageChange(page, "upsert")));
Hooks.on("updateJournalEntryPage", page => guard(board?.onPageChange(page, "upsert")));
Hooks.on("deleteJournalEntryPage", page => guard(board?.onPageChange(page, "delete")));

Hooks.on("updateJournalEntry", journal => guard(board?.onCaseChange(journal, "update")));
Hooks.on("deleteJournalEntry", journal => guard(board?.onCaseChange(journal, "delete")));
Hooks.on("createJournalEntry", journal => guard(board?.onCaseChange(journal, "update")));

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
