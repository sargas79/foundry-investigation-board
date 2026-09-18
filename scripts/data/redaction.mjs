import {CASE_FLAGS, MODULE_ID} from "../constants.mjs";

/**
 * Redacting passages of a case file, so the text is genuinely withheld from players.
 *
 * Two mechanisms look like they would do this and do not:
 *
 * - `gmOnlyFields` in the manifest guards `DataField#_sanitize`, which runs on *write*. It stops a
 *   player modifying a field. It does nothing about reading one.
 * - Page-level ownership only filters *display*. `visible` is a client-side getter over
 *   `testUserPermission(game.user, "LIMITED")` — for the client to evaluate it, the client already
 *   holds the document. A player could read the text straight out of the console.
 *
 * What does work is a **separate top-level document** the player has no permission on. So a
 * redacted passage is cut out of the page and moved into a GM-only companion JournalEntry, leaving
 * only a marker behind. Revealing moves it back.
 *
 * That makes redaction a move rather than a flag, which is why both directions exist here
 * together: a half-built version that could only redact would strand text with no way back.
 */

/** Marks where a passage was removed. Carries an id and nothing else. */
export const REDACTION_TAG = "ib-redacted";

/**
 * The companion entry holding a case's sealed passages, if it exists.
 * @param {JournalEntry} journal
 * @returns {JournalEntry|null}
 */
export function sealedEntryFor(journal) {
  const id = journal?.getFlag(MODULE_ID, CASE_FLAGS.SEALED_ENTRY);
  return id ? (game.journal.get(id) ?? null) : null;
}

/* -------------------------------------------- */

/**
 * Find or create the companion entry.
 *
 * Owned by nobody by default, which is what keeps it off every player's client. GMs reach it
 * because they can see everything, not because they are named on it.
 *
 * @param {JournalEntry} journal
 * @returns {Promise<JournalEntry>}
 */
export async function ensureSealedEntry(journal) {
  const existing = sealedEntryFor(journal);
  if ( existing ) return existing;

  const created = await JournalEntry.create({
    name: game.i18n.format("INVESTIGATION_BOARD.SealedEntryName", {name: journal.name}),
    ownership: {default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE},
    flags: {[MODULE_ID]: {[CASE_FLAGS.SEALED_FOR]: journal.id}}
  });
  await journal.setFlag(MODULE_ID, CASE_FLAGS.SEALED_ENTRY, created.id);
  return created;
}

/* -------------------------------------------- */

/**
 * The marker element that stands in for a removed passage.
 * @param {string} id
 * @param {string} label   A short, non-revealing description, e.g. "two lines".
 * @returns {string}
 */
export function redactionMarkup(id, label = "") {
  const safe = foundry.utils.escapeHTML(label);
  return `<span class="${REDACTION_TAG}" data-redaction-id="${id}"`
    + `${safe ? ` data-label="${safe}"` : ""}>&#9608;&#9608;&#9608;&#9608;&#9608;&#9608;&#9608;</span>`;
}

/* -------------------------------------------- */

/**
 * Take a passage out of a page and put it beyond players' reach.
 *
 * @param {JournalEntryPage} page      A page of sub-type `investigation-board.report`.
 * @param {string} passage             The exact HTML to remove from the body.
 * @param {string} [label]             A short description of what was removed.
 * @returns {Promise<string|null>}     The redaction's id, or null if nothing changed.
 */
export async function redactPassage(page, passage, label = "") {
  if ( !game.user.isGM ) {
    ui.notifications.warn("INVESTIGATION_BOARD.NOTIFY.RedactIsGMOnly", {localize: true});
    return null;
  }
  const body = page.system.body ?? "";
  if ( !passage || !body.includes(passage) ) return null;

  const id = foundry.utils.randomID();
  const sealedEntry = await ensureSealedEntry(page.parent);

  // The text lands in the companion entry *before* it leaves the page, so a failure here can
  // never destroy it.
  await sealedEntry.createEmbeddedDocuments("JournalEntryPage", [{
    _id: id,
    name: label || id,
    type: "text",
    text: {content: passage, format: CONST.JOURNAL_ENTRY_PAGE_FORMATS.HTML}
  }], {keepId: true});

  await page.update({
    system: {
      body: body.replace(passage, redactionMarkup(id, label)),
      sealed: [...page.system.sealed, {
        id, label, sealedBy: game.user.id, sealedAt: Date.now()
      }]
    }
  });
  return id;
}

/* -------------------------------------------- */

/**
 * Put a redacted passage back into the page, where everyone can read it.
 * @param {JournalEntryPage} page
 * @param {string} redactionId
 * @returns {Promise<boolean>}   Whether anything was revealed.
 */
export async function revealPassage(page, redactionId) {
  if ( !game.user.isGM ) {
    ui.notifications.warn("INVESTIGATION_BOARD.NOTIFY.RedactIsGMOnly", {localize: true});
    return false;
  }
  const marker = page.system.sealedMarker?.(redactionId)
    ?? page.system.sealed.find(s => s.id === redactionId);
  if ( !marker ) return false;

  const sealedEntry = sealedEntryFor(page.parent);
  const stored = sealedEntry?.pages.get(redactionId);
  if ( !stored ) {
    ui.notifications.error("INVESTIGATION_BOARD.NOTIFY.SealedTextLost", {localize: true});
    return false;
  }

  const passage = stored.text?.content ?? "";
  const body = (page.system.body ?? "").replace(
    new RegExp(`<span class="${REDACTION_TAG}"[^>]*data-redaction-id="${redactionId}"[^>]*>.*?</span>`),
    passage
  );

  await page.update({
    system: {
      body,
      sealed: page.system.sealed.filter(s => s.id !== redactionId)
    }
  });
  // Only now is the stored copy redundant.
  await stored.delete();
  return true;
}

/* -------------------------------------------- */

/**
 * Whether the text behind a redaction can be read by this user.
 *
 * Only ever true for a GM, and only because the companion entry is a document players do not
 * have. This is a convenience for the GM's own view, not a permission check — the permission is
 * the absence of the data.
 *
 * @param {JournalEntry} journal
 * @param {string} redactionId
 * @returns {string|null}
 */
export function peekSealed(journal, redactionId) {
  if ( !game.user.isGM ) return null;
  return sealedEntryFor(journal)?.pages.get(redactionId)?.text?.content ?? null;
}
