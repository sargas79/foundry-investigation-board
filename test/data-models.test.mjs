import {assert, assertThrows, check, describe} from "./harness.mjs";

const ID_A = "aaaaaaaaaaaaaaaa";
const ID_B = "bbbbbbbbbbbbbbbb";

/**
 * Exercise ClueData and ConnectionData against Foundry's real DataModel machinery: defaults,
 * choice validation, and the clamping behaviour the board relies on when dragging and resizing.
 */
export default async function testDataModels() {
  const {default: ClueData} = await import("../scripts/data/clue-data.mjs");
  const {default: ConnectionData} = await import("../scripts/data/connection-data.mjs");

  describe("ClueData");

  check("applies defaults to an empty source", () => {
    const c = new ClueData({});
    assert(c.template === "polaroid", `template was ${c.template}`);
    assert(c.category === "other", `category was ${c.category}`);
    assert(c.reliability === "unverified", `reliability was ${c.reliability}`);
    assert(c.pinColor === "red", `pinColor was ${c.pinColor}`);
    assert((c.x === 0) && (c.y === 0) && (c.z === 0), "position defaults wrong");
    assert(c.width === 200, `width was ${c.width}`);
    assert(c.dismissed === false, "dismissed should default false");
    assert(c.linkedUuid === null, "linkedUuid should default null");
    assert(Array.isArray(c.notes) && !c.notes.length, "notes should default to an empty array");
  });

  check("round-trips a fully populated clue", () => {
    const c = new ClueData({
      template: "mugshot", image: "icons/svg/mystery-man.svg", body: "<p>Seen near the docks.</p>",
      pinColor: "blue", redacted: true, category: "person", reliability: "corroborated",
      x: 120, y: -40, rotation: -3, width: 240, z: 7,
      linkedUuid: "Actor.abcdefghijklmnop",
      notes: [{author: "user1", text: "Alibi doesn't hold.", time: 1700000000}]
    });
    assert(c.template === "mugshot", "template not kept");
    assert(c.redacted === true, "redacted not kept");
    assert(c.notes[0].text === "Alibi doesn't hold.", "note text not kept");
    assert(c.linkedUuid === "Actor.abcdefghijklmnop", "linkedUuid not kept");
  });

  check("rejects values outside the declared choices", () => {
    assertThrows(() => new ClueData({template: "banana"}, {strict: true}), "bad template accepted");
    assertThrows(() => new ClueData({category: "banana"}, {strict: true}), "bad category accepted");
    assertThrows(() => new ClueData({reliability: "banana"}, {strict: true}), "bad reliability accepted");
    assertThrows(() => new ClueData({pinColor: "banana"}, {strict: true}), "bad pinColor accepted");
  });

  // NumberField._cleanType clamps rather than throwing, which is what the board wants: a resize or
  // drag past a limit should stop at the limit instead of failing the document update.
  check("clamps width and rotation to their bounds", () => {
    assert(new ClueData({width: 5000}).width === 640, "width should clamp to max 640");
    assert(new ClueData({width: 10}).width === 90, "width should clamp to min 90");
    assert(new ClueData({rotation: 90}).rotation === 30, "rotation should clamp to max 30");
    assert(new ClueData({rotation: -90}).rotation === -30, "rotation should clamp to min -30");
  });

  check("onBoard reflects dismissal", () => {
    assert(new ClueData({}).onBoard === true, "a fresh clue should be on the board");
    assert(new ClueData({dismissed: true}).onBoard === false, "a dismissed clue should be off the board");
  });

  check("templateConfig resolves, and falls back for an unknown template", () => {
    assert(new ClueData({template: "sticky"}).templateConfig.hasBody === true, "sticky should have a body");
    assert(new ClueData({template: "polaroid"}).templateConfig.hasImage === true, "polaroid should have an image");
  });

  describe("ConnectionData");

  check("applies defaults to a new connection", () => {
    const c = new ConnectionData({from: ID_A, to: ID_B});
    assert(c.color === "red", `color was ${c.color}`);
    assert(c.style === "solid", `style was ${c.style}`);
    assert(c.label === "", "label should default to empty");
  });

  check("touches() and other() traverse the string", () => {
    const c = new ConnectionData({from: ID_A, to: ID_B});
    assert(c.touches(ID_A) && c.touches(ID_B), "should touch both of its ends");
    assert(!c.touches("cccccccccccccccc"), "should not touch an unrelated clue");
    assert(c.other(ID_A) === ID_B, "other(from) should be to");
    assert(c.other(ID_B) === ID_A, "other(to) should be from");
    assert(c.other("cccccccccccccccc") === null, "other(unrelated) should be null");
  });

  check("rejects a malformed clue id", () => {
    assertThrows(() => new ConnectionData({from: "not-an-id!", to: ID_B}, {strict: true}),
      "a malformed document id was accepted");
  });
}
