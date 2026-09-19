import {MODULE_ID} from "../constants.mjs";

/**
 * Where a photograph pinned to a board is kept.
 *
 * Everything uploaded through this module lands in one folder inside the *current world's* own
 * data directory — `worlds/<world>/leads` — rather than wherever the file picker was last left.
 * The world is the right home for two reasons. Foundry's server refuses an upload into any world
 * but the one that is running, and into a module's directory unless the manifest opts in; and a
 * module directory is replaced wholesale when the module updates, which would take every
 * photograph pinned to every board with it. A folder in the world travels with the world, into
 * its backups and its exports.
 *
 * @module investigation-board/uploads
 */

/** The folder, inside the world, that images are uploaded to. */
const FOLDER = "leads";

/** The storage source the world's own directory always lives in. */
const SOURCE = "data";

/**
 * The upload folder for the world currently running.
 * @returns {string}
 */
export function leadsDirectory() {
  return `worlds/${game.world.id}/${FOLDER}`;
}

/* -------------------------------------------- */

/**
 * The folder's creation, once per session.
 * @type {Promise<string>|null}
 */
let preparing = null;

/**
 * Make sure the leads folder exists, and answer with its path.
 *
 * Cached, because this runs before every upload and the answer cannot change while the world is
 * open. A failure is *not* cached: the next upload tries again rather than being refused for the
 * rest of the session because the server was briefly unreachable.
 *
 * @returns {Promise<string>}
 */
export function ensureLeadsDirectory() {
  return preparing ??= createLeadsDirectory().catch(error => {
    preparing = null;
    throw error;
  });
}

/**
 * Create the leads folder if it is not already there.
 * @returns {Promise<string>}
 */
async function createLeadsDirectory() {
  const target = leadsDirectory();
  const picker = foundry.applications.apps.FilePicker.implementation;

  // Browsing is how you ask whether a directory exists: it rejects when it does not.
  try {
    await picker.browse(SOURCE, target);
    return target;
  }
  catch {
    // Expected on a world that has never had a clue photographed in it.
  }

  try {
    await picker.createDirectory(SOURCE, target);
  }
  catch (error) {
    // Two players pinning a photo at once both get here; whoever lost the race is still fine as
    // long as the folder now exists. Anything else is a real failure and is passed on.
    await picker.browse(SOURCE, target).catch(() => {
      throw error;
    });
  }
  return target;
}

/* -------------------------------------------- */

/**
 * The path of the most recent upload, so the picker can be shown the folder it actually went to.
 * @type {string|null}
 */
let lastUpload = null;

/**
 * The file picker class, built on first use.
 *
 * Lazily, because it extends whatever `FilePicker.implementation` resolves to — a class another
 * module may still replace after this file is imported.
 * @type {typeof foundry.applications.apps.FilePicker|null}
 */
let pickerClass = null;

/**
 * A file picker whose uploads always land in the leads folder.
 *
 * Core uploads into whichever directory is on screen at the time. Browsing stays free — an image
 * already somewhere in the world can still be picked — but a *new* file is written to one known
 * place, so a world's evidence does not end up scattered across whatever folders each player
 * happened to be looking at.
 *
 * Exported so the rule can be tested without a browser: the class it returns is the whole of the
 * behaviour, and building it is the only thing that needs a live `FilePicker` to extend.
 * @returns {typeof foundry.applications.apps.FilePicker}
 */
export function leadsFilePicker() {
  return pickerClass ??= class LeadsFilePicker extends foundry.applications.apps.FilePicker.implementation {

    /** @inheritDoc */
    static async upload(source, path, file, body = {}, options = {}) {
      let target;
      try {
        target = await ensureLeadsDirectory();
      }
      catch (error) {
        console.error(`${MODULE_ID} | the leads folder could not be prepared`, error);
        // Returned rather than thrown: the caller is core's upload field, which reports an
        // `error` on the response and would leave a rejection unhandled.
        return {error: game.i18n.localize("INVESTIGATION_BOARD.NOTIFY.LeadsFolderFailed")};
      }

      const response = await super.upload(SOURCE, target, file, body, options);
      if ( response?.path ) lastUpload = response.path;
      return response;
    }

    /* -------------------------------------------- */

    /** @inheritDoc */
    async browse(target = this.target, options = {}) {
      // After an upload core re-browses the folder that was on screen when it started. Since the
      // file went to the leads folder instead, show that — otherwise a player uploads an image
      // and it is nowhere in the list they are looking at.
      if ( lastUpload && (this.request === lastUpload) ) {
        lastUpload = null;
        target = leadsDirectory();
      }
      return super.browse(target, options);
    }
  };
}

/* -------------------------------------------- */

/**
 * Forms already wired, so a re-render does not stack a second listener.
 * @type {WeakSet<HTMLElement>}
 */
const bound = new WeakSet();

/**
 * Point a rendered form's image fields at the leads folder.
 *
 * The `<file-picker>` element core renders opens a picker of its own, at wherever the user last
 * browsed. Rather than replace the element — it is what makes the field work at all, including in
 * a popped-out window, where a module's own custom elements are not registered — this intercepts
 * the click on its browse button while the event is still travelling *down* to it. Stopping it
 * there is what keeps the element's own handler, bound on the button itself, from opening a
 * second picker alongside ours.
 *
 * Safe to call on every render.
 * @param {HTMLElement|null} root   The form, or any ancestor of the image fields.
 */
export function bindLeadsPicker(root) {
  if ( !root || bound.has(root) ) return;
  bound.add(root);
  root.addEventListener("click", onBrowse, {capture: true});
}

/**
 * Open our picker instead of the element's own.
 * @param {PointerEvent} event
 * @returns {Promise<void>}
 */
async function onBrowse(event) {
  const button = event.target.closest?.("button");
  const field = button?.closest("file-picker");
  // The element only builds a button for a user who may browse at all; anything else is a click
  // on something that is not the browse control and is none of our business.
  if ( !field || !button || (button !== field.button) ) return;

  event.preventDefault();
  event.stopPropagation();

  const Picker = leadsFilePicker();
  const picker = new Picker({
    type: field.type,
    // An image the clue already has opens where that image lives; otherwise start at the folder
    // the upload would go to anyway.
    current: field.value || await defaultDirectory(),
    allowUpload: !field.noupload,
    callback: src => field.value = src
  });
  field.picker = picker;

  await picker.browse(undefined, {render: false});
  await picker.render({force: true, window: {windowId: field.ownerDocument.defaultView.id}});
}

/* -------------------------------------------- */

/**
 * Where the picker opens when the field is empty.
 *
 * Only someone who can upload is sent to the leads folder: for anyone else it is a folder they
 * can do nothing in, and core's own last-browsed directory is the more useful place to land.
 * @returns {Promise<string>}
 */
async function defaultDirectory() {
  if ( !game.user.can("FILES_UPLOAD") ) return "";
  try {
    return await ensureLeadsDirectory();
  }
  catch (error) {
    // Not fatal: the picker opens where it usually would, and the upload itself will report why.
    console.warn(`${MODULE_ID} | the leads folder could not be prepared`, error);
    return "";
  }
}
