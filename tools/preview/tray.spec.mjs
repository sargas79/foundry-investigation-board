/**
 * In-page checks for dismissing clues and recovering them from the discarded tray.
 *
 *   node tools/preview-server.mjs   →   open /tools/preview/case.html   →   runTrayTests()
 *
 * The point of most of these is that dismissal is *not* deletion: the clue and every connection
 * it took part in survive, so a lead written off too early comes back with its web intact.
 */
export async function runTrayTests({renderer, journal, caseApi, interactions, viewport}) {
  const results = [];
  const check = async (name, fn) => {
    try { await fn(); results.push({name, ok: true}); }
    catch (err) { results.push({name, ok: false, error: err.message}); }
  };
  const assert = (cond, msg) => { if ( !cond ) throw new Error(msg); };
  const settle = (ms = 80) => new Promise(r => setTimeout(r, ms));

  const cards = () => [...document.querySelectorAll(".ib-clue")].map(e => e.dataset.clueId);
  const strings = () => [...document.querySelectorAll(".ib-string")].map(e => e.dataset.connectionId);

  await check("dismissing takes the clue and its strings off the board", async () => {
    await caseApi.dismissClue(journal.pages.get("d"));
    await settle();
    assert(!cards().includes("d"), "the dismissed card is still on the board");
    assert(!strings().includes("s3") && !strings().includes("s4"),
      `strings left behind: ${strings()}`);
  });

  // The whole promise of "set aside, not deleted".
  await check("dismissing keeps the connection documents", async () => {
    assert(!!journal.pages.get("s3"), "connection s3 was destroyed");
    assert(!!journal.pages.get("s4"), "connection s4 was destroyed");
  });

  await check("dismissing records who set it aside, and when", async () => {
    const page = journal.pages.get("d");
    assert(page.system.dismissed === true, "not marked dismissed");
    assert(page.system.dismissedBy === game.user.id, `dismissedBy was ${page.system.dismissedBy}`);
    assert(typeof page.system.dismissedAt === "number", "no timestamp was recorded");
  });

  await check("the tray lists discarded clues, most recent first", async () => {
    await caseApi.dismissClue(journal.pages.get("e"));
    await settle();
    const list = caseApi.getDismissed(journal);
    assert(list.some(p => p.id === "d"), "an earlier dismissal fell out of the tray");
    assert(list[0].id === "e", `expected the newest first, got ${list[0].id}`);
  });

  await check("recovering restores the clue and everything it was tied to", async () => {
    await caseApi.recoverClue(journal.pages.get("d"));
    await caseApi.recoverClue(journal.pages.get("e"));
    await settle();
    assert(cards().includes("d") && cards().includes("e"), `cards: ${cards()}`);
    assert(strings().includes("s3") && strings().includes("s4"),
      `the strings did not come back: ${strings()}`);
    const page = journal.pages.get("d");
    assert(page.system.dismissed === false, "still marked dismissed");
    assert(page.system.dismissedBy === null, "dismissedBy was not cleared");
    assert(page.system.dismissedAt === null, "dismissedAt was not cleared");
  });

  await check("the Delete key sets the selected clue aside", async () => {
    let dismissed = null;
    const previous = interactions.onDismiss;
    interactions.onDismiss = page => { dismissed = page.id; };
    interactions.select("b");
    viewport.dispatchEvent(new KeyboardEvent("keydown", {key: "Delete", bubbles: true, cancelable: true}));
    await settle(30);
    interactions.onDismiss = previous;
    assert(dismissed === "b", `dismissed ${dismissed}`);
  });

  // Delete must mean "delete a character" while text is being typed on a card.
  await check("Delete does nothing while typing on a card", async () => {
    let dismissed = null;
    const previous = interactions.onDismiss;
    interactions.onDismiss = page => { dismissed = page.id; };
    interactions.select("b");
    interactions.beginInlineEdit("b", "title");
    viewport.dispatchEvent(new KeyboardEvent("keydown", {key: "Delete", bubbles: true, cancelable: true}));
    await settle(30);
    await interactions.cancelInlineEdit();
    interactions.onDismiss = previous;
    assert(dismissed === null, "Delete set a clue aside mid-edit");
  });

  await check("right-clicking a card offers its actions, and Escape closes the menu", async () => {
    const card = document.querySelector('.ib-clue[data-clue-id="a"]');
    const r = card.getBoundingClientRect();
    card.dispatchEvent(new MouseEvent("contextmenu", {
      bubbles: true, cancelable: true, clientX: r.left + 20, clientY: r.top + 20
    }));
    await settle(30);
    const menu = document.querySelector(".ib-card-menu");
    assert(!!menu, "no menu appeared");
    assert(menu.querySelectorAll("button").length >= 3,
      `only ${menu.querySelectorAll("button").length} entries`);

    window.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape"}));
    await settle(30);
    assert(!document.querySelector(".ib-card-menu"), "the menu did not close");
  });

  await check("the menu closes when pressing elsewhere", async () => {
    const card = document.querySelector('.ib-clue[data-clue-id="a"]');
    const r = card.getBoundingClientRect();
    card.dispatchEvent(new MouseEvent("contextmenu", {
      bubbles: true, cancelable: true, clientX: r.left + 20, clientY: r.top + 20
    }));
    await settle(30);
    assert(!!document.querySelector(".ib-card-menu"), "no menu appeared");
    window.dispatchEvent(new PointerEvent("pointerdown", {bubbles: true, clientX: 5, clientY: 5}));
    await settle(30);
    assert(!document.querySelector(".ib-card-menu"), "the menu survived a press elsewhere");
  });

  const failed = results.filter(r => !r.ok);
  return {
    passed: results.length - failed.length,
    failed: failed.length,
    results: failed.length ? failed : results.map(r => r.name)
  };
}
