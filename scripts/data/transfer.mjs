import {CASE_FLAGS, MODULE_ID, PAGE_TYPES} from "../constants.mjs";
import {caseState} from "./case.mjs";
import {caseData} from "./case-create.mjs";

/** Bumped if the shape of an exported file ever changes. */
export const EXPORT_FORMAT = 1;

/**
 * Moving a case between worlds.
 *
 * Exports carry the board itself — clues, their placement and the strings between them — and
 * deliberately *not* ownership or `linkedUuid`. Both are meaningless in another world: a uuid
 * would point at a document that isn't there, and an ownership map at users who don't exist.
 * Dismissed clues come along, since the tray is part of the case's history.
 */

/**
 * Serialise a case.
 * @param {JournalEntry} journal
 * @returns {object}
 */
export function exportCase(journal) {
  const state = caseState(journal);
  const clues = journal.pages.filter(p => p.type === PAGE_TYPES.CLUE);
  const connections = journal.pages.filter(p => p.type === PAGE_TYPES.CONNECTION);

  // Ids are rewritten on import, so connections refer to clues by their index in this file.
  const indexOf = new Map(clues.map((p, i) => [p.id, i]));

  return {
    format: EXPORT_FORMAT,
    module: MODULE_ID,
    exportedAt: new Date().toISOString(),
    name: journal.name,
    status: state.status,
    progress: state.progress,
    classification: state.classification,
    clues: clues.map(page => ({
      name: page.name,
      ...foundry.utils.deepClone(page.system),
      // A link to a document in the world this came from cannot survive the journey.
      linkedUuid: null
    })),
    // The written record travels with the board. Redacted passages deliberately do not: they live
    // in a GM-only document precisely so they are not in anything a player could obtain, and
    // writing them into a portable file would undo that in one step.
    reports: journal.pages
      .filter(p => p.type === PAGE_TYPES.REPORT)
      .map(page => ({
        name: page.name,
        kind: page.system.kind,
        caseNumber: page.system.caseNumber,
        body: page.system.body,
        sort: page.system.sort,
        // The markers stay so the bars still read as redactions in the destination world, but
        // there is nothing behind them there and no way to reveal them.
        sealed: page.system.sealed.map(s => ({id: s.id, label: s.label}))
      })),
    connections: connections.reduce((out, page) => {
      const from = indexOf.get(page.system.from);
      const to = indexOf.get(page.system.to);
      // Drop any string whose clue is missing rather than writing a broken reference.
      if ( (from === undefined) || (to === undefined) ) return out;
      out.push({from, to, color: page.system.color, style: page.system.style, label: page.system.label});
      return out;
    }, [])
  };
}

/* -------------------------------------------- */

/**
 * Check that a parsed file looks like one of ours.
 * @param {unknown} data
 * @returns {{ok: true, data: object}|{ok: false, reason: string}}
 */
export function validateExport(data) {
  if ( !data || (typeof data !== "object") ) {
    return {ok: false, reason: "INVESTIGATION_BOARD.NOTIFY.ImportNotJSON"};
  }
  if ( data.module !== MODULE_ID ) {
    return {ok: false, reason: "INVESTIGATION_BOARD.NOTIFY.ImportWrongModule"};
  }
  if ( !Number.isInteger(data.format) || (data.format > EXPORT_FORMAT) ) {
    return {ok: false, reason: "INVESTIGATION_BOARD.NOTIFY.ImportNewerFormat"};
  }
  if ( !Array.isArray(data.clues) ) {
    return {ok: false, reason: "INVESTIGATION_BOARD.NOTIFY.ImportNoClues"};
  }
  return {ok: true, data};
}

/* -------------------------------------------- */

/**
 * Build the documents for an imported case.
 *
 * Returns plain data rather than creating anything, so the caller decides how it gets made — a GM
 * directly, or a player through the usual relay.
 *
 * @param {object} data      An export that has passed {@link validateExport}.
 * @param {string} ownerId
 * @returns {{journal: object, pages: object[]}}
 */
export function buildImport(data, ownerId) {
  const journal = caseData({
    name: String(data.name ?? "").trim() || game.i18n.localize("INVESTIGATION_BOARD.UntitledCase"),
    classification: String(data.classification ?? ""),
    ownerId
  });
  journal.flags[MODULE_ID][CASE_FLAGS.STATUS] = data.status ?? "active";
  journal.flags[MODULE_ID][CASE_FLAGS.PROGRESS] = Math.clamp(Number(data.progress) || 0, 0, 100);

  // Ids are assigned here so the connections can point at them without a second pass.
  const clueIds = data.clues.map(() => foundry.utils.randomID());

  const pages = data.clues.map((clue, index) => {
    const {name, ...system} = clue;
    return {
      _id: clueIds[index],
      name: String(name ?? "").trim() || game.i18n.localize("INVESTIGATION_BOARD.UntitledClue"),
      type: PAGE_TYPES.CLUE,
      system: {...system, linkedUuid: null}
    };
  });

  for ( const connection of data.connections ?? [] ) {
    const from = clueIds[connection.from];
    const to = clueIds[connection.to];
    if ( !from || !to ) continue;
    pages.push({
      name: "link",
      type: PAGE_TYPES.CONNECTION,
      system: {
        from, to,
        color: connection.color ?? "red",
        style: connection.style ?? "solid",
        label: connection.label ?? ""
      }
    });
  }

  for ( const report of data.reports ?? [] ) {
    pages.push({
      name: String(report.name ?? "").trim()
        || game.i18n.localize("INVESTIGATION_BOARD.UntitledFinding"),
      type: PAGE_TYPES.REPORT,
      system: {
        kind: report.kind === "brief" ? "brief" : "entry",
        caseNumber: String(report.caseNumber ?? ""),
        body: String(report.body ?? ""),
        // Authorship belongs to the world it came from; the importer becomes the writer of record.
        author: ownerId,
        createdAt: Date.now(),
        sealed: Array.isArray(report.sealed)
          ? report.sealed.map(s => ({id: String(s.id ?? ""), label: String(s.label ?? "")}))
          : [],
        sort: Number(report.sort) || 0
      }
    });
  }

  return {journal, pages};
}

/* -------------------------------------------- */

/**
 * A filename for an exported case.
 * @param {JournalEntry} journal
 * @returns {string}
 */
export function exportFilename(journal) {
  const slug = journal.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `case-${slug || "untitled"}.json`;
}
