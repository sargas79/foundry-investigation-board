import {assert, check, describe} from "./harness.mjs";

/**
 * Where an uploaded image ends up.
 *
 * Core writes an upload into whichever folder the picker happens to be showing, which scatters a
 * world's evidence across whatever each player last browsed. This module sends it to one folder
 * inside the world instead, so the checks here are about the *destination* being the world's own
 * `leads` folder however the upload was started.
 */

/**
 * A stand-in for core's FilePicker that records what it was asked to do.
 *
 * Only the four calls this module makes are implemented. `browse` rejecting for a directory that
 * is not in `dirs` is core's actual behaviour, and is how the module asks whether the folder is
 * already there.
 *
 * @param {object} [config]
 * @param {string[]} [config.dirs]                    Directories that already exist.
 * @param {(target: string, dirs: Set<string>) => void} [config.onCreate]   Stands in for a
 *   creation that does not simply succeed.
 * @returns {typeof Object}
 */
function fakeFilePicker({dirs = [], onCreate} = {}) {
  const existing = new Set(dirs);

  return class FakeFilePicker {
    static get implementation() {
      return FakeFilePicker;
    }

    static existing = existing;
    static browses = [];
    static creates = [];
    static uploads = [];

    static async browse(source, target) {
      FakeFilePicker.browses.push([source, target]);
      if ( !existing.has(target) ) throw new Error(`no such directory: ${target}`);
      return {target, dirs: [], files: []};
    }

    static async createDirectory(source, target) {
      FakeFilePicker.creates.push([source, target]);
      if ( onCreate ) onCreate(target, existing);
      else existing.add(target);
      return {target};
    }

    static async upload(source, path, file) {
      FakeFilePicker.uploads.push({source, path, name: file.name});
      return {path: `${path}/${file.name}`, status: "success"};
    }

    constructor(options = {}) {
      this.request = options.current ?? "";
      this.target = "";
      this.browsed = [];
    }

    async browse(target = this.target) {
      this.browsed.push(target);
      return {target};
    }
  };
}

/* -------------------------------------------- */

/** Bumped per load so each check gets a module with its own caches. */
let take = 0;

/**
 * A fresh copy of the module, wired to a fresh recorder.
 *
 * Imported anew each time because the module deliberately remembers the folder it has already
 * prepared — a cache that would otherwise carry one check's answer into the next.
 *
 * @param {object} [config]   Passed to {@link fakeFilePicker}.
 * @returns {Promise<{uploads: object, picker: object}>}
 */
async function load(config) {
  const picker = fakeFilePicker(config);
  globalThis.game.world = {id: "ashwood"};
  globalThis.game.user = {can: () => true};
  globalThis.foundry.applications = {apps: {FilePicker: picker}};
  const uploads = await import(`../scripts/data/uploads.mjs?take=${++take}`);
  return {uploads, picker};
}

/* -------------------------------------------- */

export default async function testUploads() {
  const applications = globalThis.foundry.applications;

  describe("the leads folder");

  await check("it belongs to the world, not to the module", async () => {
    const {uploads} = await load();
    // A module's own directory is replaced when the module updates, and Foundry's server refuses
    // an upload into it at all unless the manifest opts in.
    assert(uploads.leadsDirectory() === "worlds/ashwood/leads",
      `got ${uploads.leadsDirectory()}`);
  });

  await check("a world that has never held a clue gets the folder made for it", async () => {
    const {uploads, picker} = await load();
    assert(await uploads.ensureLeadsDirectory() === "worlds/ashwood/leads", "wrong path");
    assert(picker.creates.length === 1, `created ${picker.creates.length} directories`);
    assert(picker.creates[0][1] === "worlds/ashwood/leads", `created ${picker.creates[0][1]}`);
  });

  await check("a world that already has it is left alone", async () => {
    const {uploads, picker} = await load({dirs: ["worlds/ashwood/leads"]});
    await uploads.ensureLeadsDirectory();
    assert(picker.creates.length === 0, "an existing folder was created over");
  });

  await check("it is only asked for once, however many images are pinned", async () => {
    const {uploads, picker} = await load();
    await uploads.ensureLeadsDirectory();
    await uploads.ensureLeadsDirectory();
    await uploads.ensureLeadsDirectory();
    assert(picker.creates.length === 1, `asked the server ${picker.creates.length} times`);
  });

  // Two players pinning a photograph at the same moment both find the folder missing and both
  // try to make it. Whoever loses that race must still end up with a usable folder.
  await check("losing a race to create it is not a failure", async () => {
    const {uploads, picker} = await load({
      onCreate: (target, dirs) => {
        dirs.add(target);
        throw new Error("EEXIST: file already exists");
      }
    });
    assert(await uploads.ensureLeadsDirectory() === "worlds/ashwood/leads",
      "a folder that exists by the time we look was still treated as a failure");
    assert(picker.creates.length === 1, "the creation was retried");
  });

  await check("a refusal is reported, and not remembered", async () => {
    const {uploads, picker} = await load({
      onCreate: () => {
        throw new Error("EACCES: permission denied");
      }
    });
    let failed = false;
    await uploads.ensureLeadsDirectory().catch(() => failed = true);
    assert(failed, "a folder that could not be created resolved anyway");
    // Caching the failure would refuse every later upload for the rest of the session, even once
    // whatever was wrong with the server had been put right.
    await uploads.ensureLeadsDirectory().catch(() => {});
    assert(picker.creates.length === 2, "the second attempt never reached the server");
  });

  /* -------------------------------------------- */

  describe("uploading an image");

  await check("it lands in the leads folder wherever the picker was browsing", async () => {
    const {uploads, picker} = await load();
    const Picker = uploads.leadsFilePicker();
    // What core passes: the folder on screen at the time, which is not where this should go.
    const response = await Picker.upload("data", "icons/commodities", {name: "watch.webp"});
    assert(picker.uploads.length === 1, `${picker.uploads.length} uploads reached the server`);
    assert(picker.uploads[0].path === "worlds/ashwood/leads",
      `uploaded to ${picker.uploads[0].path}`);
    assert(picker.uploads[0].source === "data", `uploaded to the ${picker.uploads[0].source} source`);
    assert(response.path === "worlds/ashwood/leads/watch.webp", `answered with ${response.path}`);
  });

  await check("the picker then shows the folder the file actually went to", async () => {
    const {uploads} = await load();
    const Picker = uploads.leadsFilePicker();
    const response = await Picker.upload("data", "icons/commodities", {name: "watch.webp"});

    // Core re-browses the folder that was on screen when the upload began; left alone, the image
    // would be nowhere in the list the player is looking at.
    const after = new Picker({});
    after.request = response.path;
    await after.browse("icons/commodities");
    assert(after.browsed[0] === "worlds/ashwood/leads", `showed ${after.browsed[0]}`);

    // Every other browse is the user's own navigation and must be left alone.
    const browsing = new Picker({});
    await browsing.browse("icons/commodities");
    assert(browsing.browsed[0] === "icons/commodities", `redirected a plain browse to ${browsing.browsed[0]}`);
  });

  await check("an image is not uploaded at all if the folder cannot be made", async () => {
    const {uploads, picker} = await load({
      onCreate: () => {
        throw new Error("EACCES: permission denied");
      }
    });
    const Picker = uploads.leadsFilePicker();
    const quiet = console.error;
    console.error = () => {};
    let response;
    try {
      response = await Picker.upload("data", "icons/commodities", {name: "watch.webp"});
    }
    finally {
      console.error = quiet;
    }
    // Reported rather than thrown: core's upload field reads an `error` off the response, and a
    // rejection there would surface as nothing but an unhandled promise.
    assert(response.error === "INVESTIGATION_BOARD.NOTIFY.LeadsFolderFailed",
      `answered with ${JSON.stringify(response)}`);
    assert(picker.uploads.length === 0, "the file was uploaded somewhere anyway");
  });

  // Leave the globals as they were found, so a later suite sees the environment it expects.
  globalThis.foundry.applications = applications;
}
