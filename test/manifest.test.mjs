import fs from "node:fs";
import {APP, assert, check, describe} from "./harness.mjs";

/**
 * Validate module.json against Foundry's own BaseModule schema, which is what the server runs at
 * install time. Catches malformed compatibility ranges and bad documentTypes declarations.
 */
export default async function testManifest() {
  const {BaseModule} = await import(`file:///${APP}/common/packages/_module.mjs`);
  const data = JSON.parse(fs.readFileSync(new URL("../module.json", import.meta.url), "utf8"));

  describe("module.json");

  let mod;
  await check("passes BaseModule validation", () => {
    mod = new BaseModule(data, {strict: true});
    assert(mod.id === "investigation-board", `id was ${mod?.id}`);
  });

  await check("targets V14 only", () => {
    assert(mod.compatibility.minimum === "14", `minimum was ${mod.compatibility.minimum}`);
    assert(mod.compatibility.verified.startsWith("14"), `verified was ${mod.compatibility.verified}`);
  });

  await check("declares both page sub-types", () => {
    const subtypes = mod.documentTypes.JournalEntryPage;
    assert(!!subtypes.clue, "clue sub-type missing");
    assert(!!subtypes.connection, "connection sub-type missing");
  });

  await check("marks the clue body for server-side HTML sanitization", () => {
    const clue = mod.documentTypes.JournalEntryPage.clue;
    assert(clue.htmlFields?.includes("body"), "body is not declared as an htmlField");
    assert(!!clue.filePathFields?.image, "image is not declared as a filePathField");
  });

  await check("enables the socket for GM-relayed operations", () => {
    assert(mod.socket === true, "socket should be true");
  });

  await check("every declared file exists", () => {
    const root = new URL("../", import.meta.url);
    const files = [
      ...mod.esmodules,
      ...[...mod.styles].map(s => s.src ?? s),
      ...[...mod.languages].map(l => l.path)
    ];
    for ( const f of files ) {
      assert(fs.existsSync(new URL(f, root)), `declared file is missing: ${f}`);
    }
  });
}
