import fs from "node:fs";
import path from "node:path";
import {assert, check, describe} from "./harness.mjs";

const ROOT = new URL("../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const read = p => fs.readFileSync(path.join(ROOT, p), "utf8");

/**
 * Checks that destroying a case is reachable, and reachable only by a GM.
 *
 * The guard was written long before the control was, and for several releases there was no way to
 * delete a case from the board at all — the capability existed but nothing exposed it. These cover
 * both halves so they cannot drift apart again.
 */
export default async function testDeleteCase() {
  const {canDeleteCase} = await import("../scripts/data/case.mjs");
  const app = read("scripts/apps/investigation-board.mjs");
  const header = read("templates/header.hbs");
  const sidebar = read("templates/sidebar.hbs");

  const gm = {isGM: true};
  const player = {isGM: false};
  const aCase = {getFlag: (scope, key) => (key === "isCase" ? true : undefined)};
  const notACase = {getFlag: () => undefined};

  describe("canDeleteCase");

  await check("only a GM may destroy a case", () => {
    assert(canDeleteCase(aCase, gm) === true, "the GM was refused");
    assert(canDeleteCase(aCase, player) === false, "a player was allowed to destroy a case");
  });

  // The guard sits on a global hook, so it must not block unrelated journal entries.
  await check("ordinary journal entries are left alone", () => {
    assert(canDeleteCase(notACase, player) === true, "a normal journal entry was blocked");
  });

  await check("a missing user is refused rather than throwing", () => {
    assert(canDeleteCase(aCase, undefined) === false, "a clue with no user should be refused");
  });

  describe("delete control");

  await check("the board offers a way to delete a case", () => {
    assert(app.includes("deleteCase: InvestigationBoard.#onDeleteCase"),
      "no deleteCase action is registered");
    assert(header.includes('data-action="deleteCase"') || sidebar.includes('data-action="deleteCase"'),
      "no control anywhere invokes deleteCase");
  });

  // Hiding it is not the protection — the handler re-checks — but a player should never see it.
  await check("the control is shown only to a GM", () => {
    for ( const [name, template] of [["header", header], ["sidebar", sidebar]] ) {
      const index = template.indexOf('data-action="deleteCase"');
      if ( index === -1 ) continue;
      const preceding = template.slice(0, index);
      const lastOpen = Math.max(preceding.lastIndexOf("{{#if"), preceding.lastIndexOf("{{#unless"));
      assert(lastOpen !== -1, `${name}: the delete control is not inside a condition`);
      assert(/isGM/.test(preceding.slice(lastOpen)),
        `${name}: the delete control is not gated on isGM`);
    }
  });

  await check("the handler re-checks permission rather than trusting the markup", () => {
    const start = app.indexOf("#onDeleteCase(");
    assert(start > -1, "the handler is missing");
    const body = app.slice(start, app.indexOf("\n  }", start));
    assert(body.includes("canDeleteCase("), "the handler does not check canDeleteCase");
    assert(/DialogV2\.confirm/.test(body), "destroying a case is not behind a confirmation");
  });

  await check("the confirmation says how much goes with the case", () => {
    const strings = JSON.parse(read("lang/en.json"));
    const message = strings["INVESTIGATION_BOARD.DeleteCaseConfirm"];
    assert(!!message, "the confirmation message is missing");
    assert(message.includes("{name}") && message.includes("{clues}"),
      `the confirmation should name the case and count its clues: ${message}`);
  });
}
