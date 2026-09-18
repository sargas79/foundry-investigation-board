import fs from "node:fs";
import path from "node:path";
import {assert, check, describe} from "./harness.mjs";

const ROOT = new URL("../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const APP = path.join(ROOT, "scripts/apps/investigation-board.mjs");

/**
 * Guards against listeners being re-attached on every render.
 *
 * Foundry runs `_onRender` after *every* render, partial ones included, and a partial render
 * leaves the untouched parts' elements in place. Binding unconditionally therefore stacks a fresh
 * listener on those elements each time, and partial renders happen constantly — on every clue
 * change and every selection. One rename would then fire as many document updates as there had
 * been renders.
 *
 * The behaviour needs a live ApplicationV2 to exercise directly, so this checks the shape of the
 * code instead: nothing reached from `_onRender` may call `addEventListener` directly.
 */
export default async function testBindOnce() {
  const source = fs.readFileSync(APP, "utf8");

  describe("listener binding");

  // Only elements that come from a render can accumulate listeners; one built in the method that
  // uses it is new every call. Which a name refers to is tracked by its most recent assignment,
  // not by the name alone — the importer's throwaway file input and the inspector's field loop
  // variable are both called `input`, and an allowlist keyed on the bare name would be blind to
  // the very case this is guarding.
  const lines = source.split("\n");
  const origin = new Map();
  const offenders = [];

  lines.forEach((line, i) => {
    const created = line.match(/(?:const|let)\s+(\w+)\s*=\s*document\.createElement\(/);
    if ( created ) origin.set(created[1], "created");

    const queried = line.match(/(?:const|let|of)\s+(\w+)\s*(?:=|of)\s*[^=]*querySelector(?:All)?\(/)
      ?? line.match(/for\s*\(\s*const\s+(\w+)\s+of\s+[^)]*querySelectorAll\(/);
    if ( queried ) origin.set(queried[1], "rendered");

    const bind = line.match(/(\w+)\.addEventListener\(/);
    if ( !bind ) return;
    const receiver = bind[1];
    if ( receiver === "element" ) return;           // the helper itself
    if ( origin.get(receiver) === "created" ) return;
    offenders.push(`${i + 1}: ${line.trim()}`);
  });

  await check("listeners on rendered elements go through the helper", () => {
    assert(offenders.length === 0,
      `bind through #bindOnce instead:\n        ${offenders.join("\n        ")}`);
  });

  await check("the importer's file input is recognised as a throwaway", () => {
    assert(origin.get("input") !== undefined, "the file input's origin was never determined");
  });

  await check("the helper keys on the element and the event type together", () => {
    assert(/#bound = new WeakMap\(\)/.test(source),
      "the register should be a WeakMap of element to event types");
    // Keying on the element alone would silently drop the second listener an element needs —
    // the progress slider wants both input and change.
    assert(/types\.has\(type\)/.test(source), "the event type is not part of the key");
    assert(/types\.add\(type\)/.test(source), "the event type is never recorded");
  });

  await check("the progress slider still asks for both of its events", () => {
    assert(/#bindOnce\(slider, "input"/.test(source), "the live readout binding is missing");
    assert(/#bindOnce\(slider, "change"/.test(source), "the save-on-release binding is missing");
  });

  await check("every binder reached from _onRender goes through the helper", () => {
    for ( const binder of ["#bindProgress", "#bindInspectorFields", "#bindFilterFields"] ) {
      const start = source.indexOf(`${binder}() {`);
      assert(start > -1, `${binder} is missing`);
      // Read to the end of the method by matching its closing brace at method indentation.
      const body = source.slice(start, source.indexOf("\n  }", start));
      assert(body.includes("#bindOnce("), `${binder} does not use #bindOnce`);
    }
  });
}
