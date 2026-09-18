/**
 * In-page checks for BoardInteractions — dragging, selection and in-place editing.
 *
 *   node tools/preview-server.mjs   →   open /tools/preview/case.html   →   runInteractionTests()
 *
 * The page installs a stub `update()` on each stand-in page that records what was written, so
 * these assert on the document writes a gesture produces, not just on what moved on screen.
 */
export async function runInteractionTests({interactions, renderer, journal, view, viewport}) {
  const results = [];
  const check = async (name, fn) => {
    try { await fn(); results.push({name, ok: true}); }
    catch (err) { results.push({name, ok: false, error: err.message}); }
  };
  const assert = (cond, msg) => { if ( !cond ) throw new Error(msg); };
  const settle = (ms = 60) => new Promise(r => setTimeout(r, ms));

  const cardEl = id => document.querySelector(`.ib-clue[data-clue-id="${id}"]`);
  const centreOf = id => {
    const r = cardEl(id).getBoundingClientRect();
    return {x: r.left + (r.width / 2), y: r.top + (r.height / 2)};
  };
  const pointer = (target, type, x, y, button = 0) => target.dispatchEvent(new PointerEvent(type, {
    pointerId: 21, isPrimary: true, bubbles: true, cancelable: true, button,
    buttons: type === "pointerup" ? 0 : 1, clientX: x, clientY: y
  }));
  const writes = () => window.__updates;
  const resetWrites = () => { window.__updates = []; };

  view.reset();
  await settle(40);

  await check("clicking a card selects it", async () => {
    const c = centreOf("a");
    pointer(cardEl("a"), "pointerdown", c.x, c.y);
    pointer(viewport, "pointerup", c.x, c.y);
    assert(interactions.selected === "a", `selected ${interactions.selected}`);
    assert(cardEl("a").classList.contains("selected"), "the card is not marked selected");
  });

  await check("clicking bare cork clears the selection", async () => {
    const r = viewport.getBoundingClientRect();
    pointer(viewport, "pointerdown", r.left + 20, r.bottom - 20);
    pointer(viewport, "pointerup", r.left + 20, r.bottom - 20);
    assert(interactions.selected === null, `still selected ${interactions.selected}`);
  });

  // A press-and-release that barely moves is a click; it must not cost a document write.
  await check("a small movement is a click, not a drag", async () => {
    resetWrites();
    const c = centreOf("b");
    pointer(cardEl("b"), "pointerdown", c.x, c.y);
    pointer(viewport, "pointermove", c.x + 2, c.y + 1);
    pointer(viewport, "pointerup", c.x + 2, c.y + 1);
    await settle();
    assert(writes().length === 0, `a 2px nudge wrote ${writes().length} updates`);
  });

  // The whole point of ghost dragging: the board follows the pointer with no traffic, and the
  // move costs exactly one update when the pointer is released.
  await check("dragging writes exactly one update, on release", async () => {
    resetWrites();
    const page = journal.pages.get("a");
    const startX = page.system.x;
    const startY = page.system.y;
    const c = centreOf("a");
    pointer(cardEl("a"), "pointerdown", c.x, c.y);
    for ( let i = 1; i <= 12; i++ ) pointer(viewport, "pointermove", c.x + (i * 10), c.y + (i * 5));
    assert(writes().length === 0, `${writes().length} updates were written mid-drag`);

    pointer(viewport, "pointerup", c.x + 120, c.y + 60);
    await settle(80);
    assert(writes().length === 1, `${writes().length} updates on release`);

    const system = writes()[0].changes.system;
    const scale = view.transform.scale;
    assert(Math.abs(system.x - (startX + (120 / scale))) < 2, `x landed at ${system.x}`);
    assert(Math.abs(system.y - (startY + (60 / scale))) < 2, `y landed at ${system.y}`);
    assert(typeof system.z === "number", "the card was not brought to the front");
    assert(!interactions.isDragging, "the gesture did not end");
  });

  await check("drag distance is measured in board units, not screen pixels", async () => {
    view.setTransform({scale: 0.5});
    await settle(30);
    resetWrites();
    const page = journal.pages.get("c");
    const startX = page.system.x;
    const c = centreOf("c");
    pointer(cardEl("c"), "pointerdown", c.x, c.y);
    pointer(viewport, "pointermove", c.x + 100, c.y);
    pointer(viewport, "pointerup", c.x + 100, c.y);
    await settle(80);
    // Zoomed to half, 100 screen pixels must be 200 board units.
    const moved = writes()[0].changes.system.x - startX;
    assert(Math.abs(moved - 200) < 3, `moved ${moved} board units for 100px at 0.5x`);
    view.reset();
    await settle(30);
  });

  // Guards the pointer-capture bug: releasePointerCapture throwing used to strand the controller
  // mid-drag, silently discarding the move and blocking every later drag.
  await check("a second drag still works after the first", async () => {
    resetWrites();
    const c = centreOf("b");
    pointer(cardEl("b"), "pointerdown", c.x, c.y);
    pointer(viewport, "pointermove", c.x + 60, c.y + 30);
    pointer(viewport, "pointerup", c.x + 60, c.y + 30);
    await settle(80);
    assert(writes().length === 1, `the follow-up drag wrote ${writes().length} updates`);
    assert(!interactions.isDragging, "the controller is stuck in a drag");
  });

  await check("Escape during a drag reverts the card and writes nothing", async () => {
    resetWrites();
    const page = journal.pages.get("e");
    const startX = page.system.x;
    const c = centreOf("e");
    pointer(cardEl("e"), "pointerdown", c.x, c.y);
    pointer(viewport, "pointermove", c.x + 150, c.y + 80);
    viewport.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}));
    await settle();
    assert(writes().length === 0, "a cancelled drag still wrote an update");
    assert(page.system.x === startX, "the document was modified");
    assert(cardEl("e").style.getPropertyValue("--ib-x") === `${startX}px`,
      `the card stayed at ${cardEl("e").style.getPropertyValue("--ib-x")}`);
  });

  await check("double-clicking a card opens it for editing", async () => {
    window.__edited = null;
    cardEl("b").dispatchEvent(new MouseEvent("dblclick", {bubbles: true, cancelable: true}));
    assert(window.__edited === "b", `asked to edit ${window.__edited}`);
  });

  await check("a clue the user does not own can be selected but not moved", async () => {
    const page = journal.pages.get("d");
    page.isOwner = false;
    resetWrites();
    const c = centreOf("d");
    pointer(cardEl("d"), "pointerdown", c.x, c.y);
    pointer(viewport, "pointermove", c.x + 90, c.y + 40);
    pointer(viewport, "pointerup", c.x + 90, c.y + 40);
    await settle();
    assert(writes().length === 0, "a non-owner moved a clue");
    assert(interactions.selected === "d", "a non-owner should still be able to inspect it");
    page.isOwner = true;
  });

  /* --- In-place editing ------------------------------------------------- */

  // Commits are driven through commitInlineEdit() rather than by blurring the element: the
  // preview pane never holds document focus, so focus()/blur() are inert here. That is exactly
  // why the commit path does not depend on blur alone.
  await check("editing a title in place commits", async () => {
    resetWrites();
    interactions.beginInlineEdit("b", "title");
    const target = cardEl("b").querySelector(".ib-clue-title");
    assert(target.contentEditable === "true", "the title did not become editable");
    target.textContent = "Forensic Report (revised)";
    await interactions.commitInlineEdit();
    await settle();
    assert(writes().length === 1, `${writes().length} updates written`);
    assert(writes()[0].changes.name === "Forensic Report (revised)",
      `wrote name ${writes()[0].changes.name}`);
    assert(!interactions.isEditing, "the edit did not end");
  });

  await check("Escape abandons an in-place edit", async () => {
    resetWrites();
    const before = journal.pages.get("b").name;
    interactions.beginInlineEdit("b", "title");
    const target = cardEl("b").querySelector(".ib-clue-title");
    target.textContent = "Typed then abandoned";
    target.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true, cancelable: true}));
    await settle();
    assert(writes().length === 0, "an abandoned edit still wrote an update");
    assert(target.textContent === before, `the card shows "${target.textContent}"`);
  });

  await check("an unchanged edit writes nothing", async () => {
    resetWrites();
    interactions.beginInlineEdit("b", "title");
    await interactions.commitInlineEdit();
    await settle();
    assert(writes().length === 0, "a no-op edit wrote an update");
  });

  await check("emptying a title falls back rather than failing validation", async () => {
    resetWrites();
    interactions.beginInlineEdit("b", "title");
    cardEl("b").querySelector(".ib-clue-title").textContent = "   ";
    await interactions.commitInlineEdit();
    await settle();
    assert(writes().length === 1, "no update was written");
    assert(writes()[0].changes.name?.length > 0, "an empty name was written");
  });

  // A previous edit whose blur never arrived must not block editing for the rest of the session.
  await check("starting a new edit finishes the outstanding one", async () => {
    resetWrites();
    interactions.beginInlineEdit("b", "title");
    cardEl("b").querySelector(".ib-clue-title").textContent = "First edit";
    // No commit — begin another edit straight away.
    interactions.beginInlineEdit("e", "title");
    await settle();
    assert(writes().length === 1, `the outstanding edit wrote ${writes().length} updates`);
    assert(writes()[0].changes.name === "First edit", `wrote ${writes()[0].changes.name}`);
    assert(interactions.isEditing, "the new edit did not start");
    await interactions.cancelInlineEdit();
  });

  // The rendered body is *enriched* HTML, so an in-place edit must round-trip as plain text —
  // writing innerHTML back would save @UUID links already expanded into anchors.
  await check("editing a body in place stores escaped paragraphs, not markup", async () => {
    resetWrites();
    interactions.beginInlineEdit("d", "body");
    cardEl("d").querySelector(".ib-clue-body").textContent = "Check the <ledger> & the receipts";
    await interactions.commitInlineEdit();
    await settle();
    assert(writes().length === 1, `${writes().length} updates written`);
    const body = writes()[0].changes.system.body;
    assert(body.startsWith("<p>") && body.endsWith("</p>"), `body was ${body}`);
    assert(body.includes("&lt;ledger&gt;"), `angle brackets were not escaped: ${body}`);
    assert(body.includes("&amp;"), `ampersand was not escaped: ${body}`);
  });

  await check("dragging cannot start from inside the text being edited", async () => {
    resetWrites();
    interactions.beginInlineEdit("d", "body");
    const target = cardEl("d").querySelector(".ib-clue-body");
    const r = target.getBoundingClientRect();
    pointer(target, "pointerdown", r.left + 5, r.top + 5);
    pointer(viewport, "pointermove", r.left + 80, r.top + 40);
    pointer(viewport, "pointerup", r.left + 80, r.top + 40);
    await settle();
    assert(!interactions.isDragging, "a drag started from inside an edit");
    assert(writes().every(w => w.changes.system?.x === undefined),
      "a drag from inside an edit moved the card");
    await interactions.cancelInlineEdit();
    await settle();
  });

  // Clicking elsewhere has to save, since blur cannot be relied on to have fired.
  await check("pressing elsewhere on the board commits the edit", async () => {
    resetWrites();
    interactions.beginInlineEdit("e", "title");
    cardEl("e").querySelector(".ib-clue-title").textContent = "Witness (interviewed)";
    const r = viewport.getBoundingClientRect();
    pointer(viewport, "pointerdown", r.left + 15, r.bottom - 15);
    pointer(viewport, "pointerup", r.left + 15, r.bottom - 15);
    await settle();
    assert(!interactions.isEditing, "the edit is still open");
    assert(writes().some(w => w.changes.name === "Witness (interviewed)"),
      `the edit was not saved: ${JSON.stringify(writes())}`);
  });

  const failed = results.filter(r => !r.ok);
  return {
    passed: results.length - failed.length,
    failed: failed.length,
    results: failed.length ? failed : results.map(r => r.name)
  };
}
