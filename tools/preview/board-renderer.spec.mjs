/**
 * In-page checks for BoardRenderer.
 *
 * These exercise the incremental update path that the whole of milestone 3 rests on: a clue
 * changing must patch its existing card rather than replace it, and a drag must be able to move a
 * card and its strings without writing to the document on every pointer move.
 *
 *   node tools/preview-server.mjs   →   open /tools/preview/case.html   →   runBoardRendererTests()
 */
export async function runBoardRendererTests({renderer, journal, makePage, CLUE, CONN}) {
  const results = [];
  const check = async (name, fn) => {
    try { await fn(); results.push({name, ok: true}); }
    catch (err) { results.push({name, ok: false, error: err.message}); }
  };
  const assert = (cond, msg) => { if ( !cond ) throw new Error(msg); };

  const cards = () => [...document.querySelectorAll(".ib-clue")].map(e => e.dataset.clueId);
  const strings = () => [...document.querySelectorAll(".ib-string")].map(e => e.dataset.connectionId);
  const cardEl = id => document.querySelector(`.ib-clue[data-clue-id="${id}"]`);

  await check("a dismissed clue and a dangling connection are never drawn", async () => {
    await renderer.render(journal);
    assert(!cards().includes("z"), "a dismissed clue was drawn");
    // s5 attaches to the dismissed clue, s6 points at a clue that does not exist.
    assert(!strings().includes("s5"), "a string to a dismissed clue was drawn");
    assert(!strings().includes("s6"), "a dangling string was drawn");
  });

  // Replacing the node instead of patching it would cancel an in-flight drag and drop focus.
  await check("updating a clue patches its existing card rather than replacing it", async () => {
    const before = cardEl("a");
    const page = journal.pages.get("a");
    page.name = "Mara Vale (confirmed)";
    page.system.reliability = "corroborated";
    await renderer.upsertClue(page);
    assert(cardEl("a") === before, "the card element was replaced");
    assert(cardEl("a").querySelector(".ib-clue-title").textContent === "Mara Vale (confirmed)",
      "the title was not updated");
    assert(cardEl("a").dataset.reliability === "corroborated", "the reliability was not updated");
  });

  await check("dismissing a clue removes it and every string touching it", async () => {
    const page = journal.pages.get("d");
    page.system.dismissed = true;
    await renderer.upsertClue(page);
    assert(!cards().includes("d"), "the dismissed card is still on the board");
    assert(!strings().includes("s3") && !strings().includes("s4"),
      `strings left behind: ${strings()}`);
  });

  await check("recovering a clue restores it and its strings", async () => {
    const page = journal.pages.get("d");
    page.system.dismissed = false;
    await renderer.upsertClue(page);
    assert(cards().includes("d"), "the recovered card is missing");
    assert(strings().includes("s3") && strings().includes("s4"),
      `strings not restored: ${strings()}`);
  });

  await check("a new clue and a new connection appear", async () => {
    const clue = makePage("tmp-clue", CLUE, "Anonymous tip", {
      template: "letter", pinColor: "blue", category: "testimony", reliability: "questionable",
      x: 900, y: 120, width: 190, body: "<p>Check the ledger.</p>"
    });
    journal.pages.add(clue);
    await renderer.upsertClue(clue);
    assert(cards().includes("tmp-clue"), "the new card was not added");

    const conn = makePage("tmp-conn", CONN, "link", {from: "tmp-clue", to: "c", color: "blue"});
    journal.pages.add(conn);
    renderer.upsertConnection(conn);
    assert(strings().includes("tmp-conn"), `the new string was not drawn: ${strings()}`);
  });

  await check("removing a clue takes its strings with it", async () => {
    journal.pages.delete("tmp-clue");
    renderer.removeClue("tmp-clue");
    assert(!cards().includes("tmp-clue"), "the card is still present");
    assert(!strings().includes("tmp-conn"), `a dangling string was left: ${strings()}`);
    journal.pages.delete("tmp-conn");
  });

  // The drag path: the card and its strings must follow the pointer with no document writes.
  await check("moveGhost moves a card and its strings without writing to the document", async () => {
    const page = journal.pages.get("a");
    const originalX = page.system.x;
    const line = document.querySelector('.ib-string[data-connection-id="s1"] .ib-string-line');
    const before = line.getAttribute("d");

    renderer.moveGhost("a", 300, 300);
    assert(cardEl("a").style.getPropertyValue("--ib-x") === "300px", "the card did not move");
    assert(line.getAttribute("d") !== before, "the string did not follow the card");
    assert(page.system.x === originalX, "the document was written during a ghost move");

    renderer.moveGhost("a", originalX, page.system.y);
    renderer.clearGhost("a");
  });

  // Enriching bodies is async, so a case switch can land mid-flight. Without a generation guard
  // the suspended render resumes and appends the previous case's cards onto the new board.
  await check("a render interrupted by a case switch does not leak its cards", async () => {
    const other = {
      id: "other-case", name: "Dockside", visible: true,
      flags: {"investigation-board": {isCase: true}},
      getFlag(scope, key) { return this.flags?.[scope]?.[key]; },
      pages: {get: () => undefined, filter: () => [], contents: []}
    };
    // Start rendering the populated case, then switch to the empty one without awaiting.
    const first = renderer.render(journal);
    const second = renderer.render(other);
    await Promise.all([first, second]);
    assert(cards().length === 0,
      `the abandoned render leaked ${cards().length} cards onto the new case`);
    await renderer.render(journal);
    assert(cards().length > 0, "re-rendering the original case drew nothing");
  });

  await check("an upsert interrupted by a case switch does not leak its card", async () => {
    const page = journal.pages.get("b");
    const other = {
      id: "other-case-2", name: "Cold Case", visible: true,
      flags: {"investigation-board": {isCase: true}},
      getFlag(scope, key) { return this.flags?.[scope]?.[key]; },
      pages: {get: () => undefined, filter: () => [], contents: []}
    };
    const pending = renderer.upsertClue(page);
    await renderer.render(other);
    await pending;
    assert(!cards().includes("b"), "a clue from the previous case was appended");
    await renderer.render(journal);
  });

  await check("clear empties the board", async () => {
    renderer.clear();
    assert(cards().length === 0, `${cards().length} cards left`);
    assert(strings().length === 0, `${strings().length} strings left`);
    await renderer.render(journal);
    assert(cards().length > 0, "re-rendering after clear drew nothing");
  });

  const failed = results.filter(r => !r.ok);
  return {
    passed: results.length - failed.length,
    failed: failed.length,
    results: failed.length ? failed : results.map(r => r.name)
  };
}
