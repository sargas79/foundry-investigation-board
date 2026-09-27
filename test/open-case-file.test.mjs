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

  class StubApplication {
    constructor(options = {}) {
      this.options = options;
      this.rendered = false;
      this.renders = [];
    }

    async render(options) {
      this.renders.push(options);
      this.rendered = true;
      instances.set(this.constructor.DEFAULT_OPTIONS.id, this);
      return this;
    }
  }

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
    foundry.applications = {...previous, instances};
  }

  describe("opening the case file");

  await check("the first open creates the window for that case", async () => {
    instances.clear();
    const file = await CaseFile.open("c1");
    assert(file.caseId === "c1", `opened for ${file.caseId}`);
    assert(file.renders[0]?.force === true, "the window was not forced open");
  });

  await check("opening again reuses the window instead of orphaning it", async () => {
    instances.clear();
    const first = await CaseFile.open("c1");
    const again = await CaseFile.open("c1");
    assert(again === first, "a second window was created for the same case");
    assert(first.renders.length === 2 && first.renders[1].force === true,
      "the open window was not brought back to the front");
  });

  await check("opening another case switches the open window to it", async () => {
    instances.clear();
    const first = await CaseFile.open("c1");
    const other = await CaseFile.open("c2");
    assert(other === first, "a second window was created");
    assert(first.caseId === "c2", `the window still shows ${first.caseId}`);
  });

  await check("a window that has been closed is replaced by a new one", async () => {
    instances.clear();
    const first = await CaseFile.open("c1");
    first.rendered = false;
    const next = await CaseFile.open("c1");
    assert(next !== first, "a closed window was revived");
  });

  describe("double-clicking a case name");

  const source = fs.readFileSync(BOARD, "utf8");
  const start = source.indexOf("async #onCaseNameDoubleClick(");
  const handler = source.slice(start, source.indexOf("\n  }", start));

  await check("the listener sits on the window, which survives re-renders", () => {
    // The first click re-renders the sidebar, so a listener on the row itself would be gone
    // by the time the double-click arrives.
    assert(/#bindOnce\(this\.element, "dblclick"/.test(source),
      "the double-click is not bound once on the window");
    assert(start > -1, "the handler is missing");
  });

  await check("only a case's name opens the file, not the buttons beside it", () => {
    const selector = handler.match(/closest\?\.\("([^"]+)"\)/)?.[1] ?? "";
    assert(selector.includes(".ib-case-open"), "the sidebar's case names are not matched");
    assert(selector.includes(".ib-case-title[data-case-id]"),
      "the header title is not matched, or is matched even with no case open");
    assert(!selector.includes("ib-case-cog") && !selector.includes("ib-case-row,"),
      "the row's other buttons would open the file too");
  });

  await check("the case is selected and its file opened", () => {
    assert(/this\.showCase\(caseId\)/.test(handler), "the case is not selected");
    assert(/CaseFile\.open\(caseId\)/.test(handler), "the file is not opened");
  });
}
