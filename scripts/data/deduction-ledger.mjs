import {MODULE_ID, SETTINGS} from "../constants.mjs";
import {emptyLedger, normalizeLedger, parseSkills} from "./deductions.mjs";
import {ensureSealedEntry, sealedEntryFor} from "./redaction.mjs";

/**
 * Where a case's deduction ledger lives, and how it is read and written.
 *
 * The ledger is the GM's secret: difficulty, bonuses, who rolled what and whether the GM is meant
 * to lie. So it goes where redacted passages go — a flag on the case's GM-only companion entry, a
 * document a player's client is never sent. A flag on the case itself would be one console command
 * away from any player the case is shared with.
 *
 * Stored as a JSON string rather than an object. Foundry merges object flags on update, so a key
 * removed from the ledger (a cleared manual skill level, a deleted source) would quietly come back;
 * a string is replaced whole.
 */

/** Flag key on the companion entry. */
export const LEDGER_FLAG = "deductionLedger";

/**
 * Whether the Monster Hunters rules are switched on in this world.
 * @returns {boolean}
 */
export function rulesEnabled() {
  try {
    return !!game.settings.get(MODULE_ID, SETTINGS.MONSTER_HUNTERS);
  }
  catch {
    return false;
  }
}

/* -------------------------------------------- */

/**
 * A case's ledger. Empty for anyone who cannot see the companion entry — which is every player.
 * @param {JournalEntry} journal
 * @returns {object}
 */
export function readLedger(journal) {
  const raw = sealedEntryFor(journal)?.getFlag(MODULE_ID, LEDGER_FLAG);
  if ( !raw ) return emptyLedger();
  try {
    return normalizeLedger(typeof raw === "string" ? JSON.parse(raw) : raw);
  }
  catch (err) {
    console.error(`${MODULE_ID} | unreadable deduction ledger on ${journal?.name}`, err);
    return emptyLedger();
  }
}

/**
 * Whether a case has a ledger with anything in it worth exporting.
 * @param {JournalEntry} journal
 * @returns {boolean}
 */
export function hasLedger(journal) {
  return !!sealedEntryFor(journal)?.getFlag(MODULE_ID, LEDGER_FLAG);
}

/* -------------------------------------------- */

/** Writes in flight, per case, so two quick clicks cannot each read the ledger before either saves. */
const queues = new Map();

/**
 * Change a case's ledger. GM only.
 *
 * Reads, applies `change` and writes, one change at a time per case: every button in the tracker
 * is a read-modify-write, and without the queue a fast double click would lose one of them.
 *
 * @param {JournalEntry} journal
 * @param {(ledger: object) => object|void|Promise<object|void>} change   Returns the new ledger, or
 *                                                                       mutates the one it is given.
 * @returns {Promise<object>}   The ledger as saved.
 */
export function updateLedger(journal, change) {
  if ( !game.user.isGM ) {
    ui.notifications.warn("INVESTIGATION_BOARD.NOTIFY.DeductionsAreGMOnly", {localize: true});
    return Promise.resolve(readLedger(journal));
  }
  const previous = queues.get(journal.id) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(async () => {
    const current = readLedger(journal);
    const changed = (await change(current)) ?? current;
    const saved = normalizeLedger(changed);
    const entry = await ensureSealedEntry(journal);
    await entry.setFlag(MODULE_ID, LEDGER_FLAG, JSON.stringify(saved));
    return saved;
  });
  queues.set(journal.id, next);
  next.finally(() => {
    if ( queues.get(journal.id) === next ) queues.delete(journal.id);
  }).catch(() => {});
  return next;
}

/**
 * Write a whole ledger, as on import. GM only.
 * @param {JournalEntry} journal
 * @param {object} ledger
 * @returns {Promise<object>}
 */
export function writeLedger(journal, ledger) {
  return updateLedger(journal, () => ledger);
}

/* -------------------------------------------- */
/*  Reading characters                          */
/* -------------------------------------------- */

/**
 * Every skill on an actor, as `{name, spec, level}`.
 *
 * Reads the GURPS Game Aid system's `system.skills` tree (entries nest under `contains` and
 * `collapsed`), and also any embedded items that are skills, which covers systems that store
 * skills as items. Anything it cannot read is skipped rather than guessed at; the GM can always
 * enter a level by hand.
 *
 * @param {Actor} actor
 * @returns {{name: string, spec: string, level: number}[]}
 */
export function actorSkills(actor) {
  if ( !actor ) return [];
  const raw = [];
  walkTree(actor.system?.skills, entry => raw.push({name: entry.name, level: entryLevel(entry)}));
  for ( const item of actor.items ?? [] ) {
    if ( !/skill/i.test(item.type) ) continue;
    const sys = item.system ?? {};
    raw.push({
      name: sys.name ?? item.name,
      level: Number(sys.level ?? sys.calc?.level ?? sys.skill?.level ?? sys.import)
    });
  }
  return parseSkills(raw);
}

/**
 * Whether an actor has an advantage, by name (e.g. "Intuition").
 * @param {Actor} actor
 * @param {string} name
 * @returns {boolean}
 */
export function actorHasTrait(actor, name) {
  if ( !actor ) return false;
  const want = name.toLowerCase();
  const matches = n => String(n ?? "").toLowerCase().replace(/\s*\(.*\)\s*$/, "").trim() === want;
  let found = false;
  walkTree(actor.system?.ads, entry => { if ( matches(entry.name) ) found = true; });
  if ( found ) return true;
  return (actor.items ?? []).some(item => /advantage|trait|feature/i.test(item.type)
    && matches(item.system?.name ?? item.name));
}

/** Visit every named entry in a GURPS Game Aid list, nested ones included. */
function walkTree(tree, visit, depth = 0) {
  if ( !tree || (typeof tree !== "object") || (depth > 8) ) return;
  for ( const entry of Object.values(tree) ) {
    if ( !entry || (typeof entry !== "object") ) continue;
    if ( entry.name ) visit(entry);
    walkTree(entry.contains, visit, depth + 1);
    walkTree(entry.collapsed, visit, depth + 1);
  }
}

/** A GURPS Game Aid entry's level: computed if present, else the level it was imported with. */
function entryLevel(entry) {
  const computed = Number(entry.level);
  if ( Number.isFinite(computed) && (computed > 0) ) return computed;
  return Number.parseInt(entry.import, 10);
}
