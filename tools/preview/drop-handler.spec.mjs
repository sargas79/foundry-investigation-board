/**
 * In-page checks for DropHandler — dragging documents from Foundry's sidebar onto the cork.
 *
 *   node tools/preview-server.mjs   →   open /tools/preview/case.html   →   runDropTests()
 *
 * The page provides a small stand-in world of droppable documents and records what
 * `createEmbeddedDocuments` was asked to make, so these assert on the clue that would be written.
 */
export async function runDropTests({viewport, view}) {
  const results = [];
  const check = async (name, fn) => {
    try { await fn(); results.push({name, ok: true}); }
    catch (err) { results.push({name, ok: false, error: err.message}); }
  };
  const assert = (cond, msg) => { if ( !cond ) throw new Error(msg); };
  const settle = (ms = 80) => new Promise(r => setTimeout(r, ms));

  const created = () => window.__created;
  const rect = () => viewport.getBoundingClientRect();

  /** Simulate dropping a document from the sidebar at a screen position. */
  const dropAt = (uuid, type, x, y) => {
    const dataTransfer = new DataTransfer();
    dataTransfer.setData("text/plain", JSON.stringify({type, uuid}));
    viewport.dispatchEvent(new DragEvent("drop", {
      bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer
    }));
  };

  await check("dragging over the board advertises a drop, and leaving clears it", async () => {
    const dataTransfer = new DataTransfer();
    const r = rect();
    viewport.dispatchEvent(new DragEvent("dragover", {
      bubbles: true, cancelable: true, dataTransfer, clientX: r.left + 100, clientY: r.top + 100
    }));
    assert(viewport.classList.contains("drop-target"), "the board did not mark itself a drop target");
    viewport.dispatchEvent(new DragEvent("dragleave", {bubbles: true, dataTransfer}));
    assert(!viewport.classList.contains("drop-target"), "the drop target mark was not cleared");
  });

  await check("dropping an Actor pins a linked mugshot", async () => {
    window.__created = [];
    const r = rect();
    dropAt("Actor.npc1", "Actor", r.left + 200, r.top + 180);
    await settle();
    assert(created().length === 1, `created ${created().length} clues`);
    const clue = created()[0];
    assert(clue.name === "Silas Trent", `named ${clue.name}`);
    assert(clue.system.template === "mugshot", `template ${clue.system.template}`);
    assert(clue.system.category === "person", `category ${clue.system.category}`);
    // The clue points at the document rather than copying it, so a rename is never stale.
    assert(clue.system.linkedUuid === "Actor.npc1", `linked to ${clue.system.linkedUuid}`);
    assert(clue.system.image === "icons/svg/npc.svg", `image ${clue.system.image}`);
  });

  await check("dropping an Item pins a polaroid of physical evidence", async () => {
    window.__created = [];
    const r = rect();
    dropAt("Item.itm1", "Item", r.left + 300, r.top + 200);
    await settle();
    assert(created()[0].system.template === "polaroid", `template ${created()[0].system.template}`);
    assert(created()[0].system.category === "physical", `category ${created()[0].system.category}`);
  });

  await check("dropping a Scene pins a map using its thumbnail", async () => {
    window.__created = [];
    const r = rect();
    dropAt("Scene.scn1", "Scene", r.left + 350, r.top + 250);
    await settle();
    assert(created()[0].system.template === "map", `template ${created()[0].system.template}`);
    assert(created()[0].system.image === "icons/svg/map.svg", `image ${created()[0].system.image}`);
  });

  // Foundry's generic placeholder art says less than no picture at all.
  await check("a generic placeholder image is not used", async () => {
    window.__created = [];
    const r = rect();
    dropAt("Actor.faceless", "Actor", r.left + 400, r.top + 260);
    await settle();
    assert(created()[0].system.image === null, `image was ${created()[0].system.image}`);
    assert(created()[0].system.template === "document",
      `should fall back to a template with no photo, got ${created()[0].system.template}`);
  });

  await check("the card lands near where it was dropped", async () => {
    window.__created = [];
    const r = rect();
    const x = r.left + 520;
    const y = r.top + 300;
    dropAt("Item.itm1", "Item", x, y);
    await settle();
    const board = view.screenToBoard(x, y);
    // freeSpotNear offsets so the card is centred under the cursor, and may nudge to avoid a pile.
    assert(Math.abs(created()[0].system.x - board.x) < 180,
      `landed at ${created()[0].system.x}, dropped at ${Math.round(board.x)}`);
  });

  await check("an unresolvable drop warns instead of pinning a blank card", async () => {
    window.__created = [];
    window.__warnings = [];
    const r = rect();
    dropAt("Actor.ghost", "Actor", r.left + 250, r.top + 220);
    await settle();
    assert(created().length === 0, "a card was created for a missing document");
    assert(window.__warnings.length === 1, `warnings: ${JSON.stringify(window.__warnings)}`);
  });

  await check("a drop carrying nothing useful is ignored", async () => {
    window.__created = [];
    const dataTransfer = new DataTransfer();
    dataTransfer.setData("text/plain", "not json at all");
    const r = rect();
    viewport.dispatchEvent(new DragEvent("drop", {
      bubbles: true, cancelable: true, dataTransfer, clientX: r.left + 120, clientY: r.top + 120
    }));
    await settle();
    assert(created().length === 0, "a card was created from junk");
  });

  const failed = results.filter(r => !r.ok);
  return {
    passed: results.length - failed.length,
    failed: failed.length,
    results: failed.length ? failed : results.map(r => r.name)
  };
}
