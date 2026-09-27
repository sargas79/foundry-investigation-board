import fs from "node:fs";
import path from "node:path";
import {assert, check, describe} from "./harness.mjs";

const ROOT = new URL("../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const BOARD = path.join(ROOT, "scripts/apps/investigation-board.mjs");

/**
 * Opening the case file by double-clicking a case's name (#78).
 *
 * The case file is a real ApplicationV2 subclass, so it is loaded here against a stand-in base
 * class that records renders and registers itself the way Foundry does. That is enough to prove
 * the window is reused rather than duplicated. The board's listener needs a live DOM, so its
 * wiring is checked by the shape of the code instead, as the listener-binding checks do.
 */
export default async function testOpenCaseFile() {
  const instances = new Map();

  // Mirrors the parts of ApplicationV2 that open() relies on: the render states, and a close that
  // unregisters the id when it finishes — whichever instance holds it by then.
  class StubApplication {
    static RENDER_STATES = {NONE: 0, RENDERING: 1, RENDERED: 2, CLOSING: 3, CLOSED: 4};

    constructor(options = {}) {
      this.options = options;
      this.state = StubApplication.RENDER_STATES.NONE;
      this.renders = [];
      this.closes = 0;
    }

    get rendered() {
      return this.state === StubApplication.RENDER_STATES.RENDERED;
    }

    async render(options) {
      this.renders.push(options);
      this.state = StubApplication.RENDER_STATES.RENDERED;
      instances.set(this.constructor.DEFAULT_OPTIONS.id, this);
      return this;
    }

    async close() {
      this.closes++;
      this.state = StubApplication.RENDER_STATES.CLOSED;
      instances.delete(this.constructor.DEFAULT_OPTIONS.id);
      return this;
    }
  }

  // Only for loading the module: it reads the base classes once, at import.
  const had = Object.hasOwn(foundry, "applications");
  const previous = foundry.applications;
  foundry.applications = {
    instances,
    api: {ApplicationV2: StubApplication, HandlebarsApplicationMixin: Base => class extends Base {}}
  };
  let CaseFile;
  try {
    ({default: CaseFile} = await import("../scripts/apps/case-file.mjs"));
  }
  finally {
    if ( had ) foundry.applications = previous;
    else delete foundry.applications;
  }

  // open() looks the window up at call time, so each check lends it the registry for the call.
  const withRegistry = async fn => {
    foundry.applications = {instances};
    try {
      instances.clear();
      await fn();
    }
    finally {
      if ( had ) foundry.applications = previous;
      else delete foundry.applications;
    }
  };

  describe("opening the case file");

  await check("the first open creates the window for that case", () => withRegistry(async () => {
    const file = await CaseFile.open("c1");
    assert(file.caseId === "c1", `opened for ${file.caseId}`);
    assert(file.renders[0]?.force === true, "the window was not forced open");
  }));

  await check("opening again reuses the window instead of orphaning it", () => withRegistry(async () => {
    const first = await CaseFile.open("c1");
    const again = await CaseFile.open("c1");
    assert(again === first, "a second window was created for the same case");
    assert(first.renders.length === 2 && first.renders[1].force === true,
      "the open window was not brought back to the front");
  }));

  await check("opening another case switches the open window to it", () => withRegistry(async () => {
    const first = await CaseFile.open("c1");
    const other = await CaseFile.open("c2");
    assert(other === first, "a second window was created");
    assert(first.caseId === "c2", `the window still shows ${first.caseId}`);
  }));

  await check("a window that has been closed is replaced by a new one", () => withRegistry(async () => {
    const first = await CaseFile.open("c1");
    await first.close();
    const next = await CaseFile.open("c1");
    assert(next !== first, "a closed window was revived");
  }));

  await check("a window still closing is waited out, so its close cannot orphan the new one",
    () => withRegistry(async () => {
      const first = await CaseFile.open("c1");
      first.state = first.constructor.RENDER_STATES.CLOSING;
      const next = await CaseFile.open("c1");
      assert(first.closes === 1, "the closing window was not waited for");
      assert(next !== first, "a closing window was revived");
      assert(instances.get(CaseFile.DEFAULT_OPTIONS.id) === next,
        "the new window is not the one registered");
    }));

  describe("double-clicking a case name");

  const source = fs.readFileSync(BOARD, "utf8");
  const start = source.indexOf("  #onCaseNameDoubleClick(event) {");
  const handler = source.slice(start, source.indexOf("\n  }", start));

  await check("the listener sits on the window, which survives re-renders", () => {
    // The first click re-renders the sidebar, so a listener on the row itself would be gone
    // by the time the double-click arrives.
    assert(/#bindOnce\(this\.element, "dblclick"/.test(source),
      "the double-click is not bound once on the window");
    assert(start > -1, "the handler is missing");
  });

  await check("only a case's name opens the file, not the buttons beside it", () => {
    // Matched exactly: a looser selector such as ".ib-case-row" would also catch the row's
    // details and delete buttons, and a substring check would not notice.
    const selector = handler.match(/closest\?\.\("([^"]+)"\)/)?.[1] ?? "";
    const parts = selector.split(",").map(p => p.trim()).sort();
    const expected = [".ib-case-row .ib-case-open", ".ib-case-title[data-case-id]"];
    assert(JSON.stringify(parts) === JSON.stringify(expected),
      `the double-click matches ${JSON.stringify(parts)}`);
  });

  await check("the file opens without waiting on the board to redraw", () => {
    // The clicks have already selected the case; waiting on the redraw again would let a board
    // render failure stop the file opening.
    assert(/CaseFile\.open\(caseId\)/.test(handler), "the file is not opened");
    assert(!/showCase|await /.test(handler), "the file waits on the board");
  });
}
