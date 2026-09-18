# Investigation Board

A corkboard for collaborative investigation in **Foundry VTT V14**. Players pin clues, string them
together, and work cases as a party — no GM required at the table.

## Installation

Paste this manifest URL into Foundry's **Add-on Modules → Install Module**:

```
https://github.com/sargas79/foundry-investigation-board/releases/latest/download/module.json
```

Then enable **Investigation Board** in your world's module settings.

## Opening the board

- The thumbtack in the **token scene controls**
- **Shift+I**
- `game.modules.get("investigation-board").api.open()` from a macro

## Working a case

**Start one** with **New Case** in the sidebar. You choose there and then whether it's yours alone,
something the party can watch, or something everyone can work on — see [Sharing](#sharing) for why
that choice is offered up front.

**Pin evidence** from the toolbar, or drag an **Actor, Item or Scene from the sidebar** straight
onto the cork. A dropped document is *linked*, not copied: rename an NPC and the clue still points
at them, and the link marker on the card opens the original.

**Jot a lead** with Create Lead — one click drops a sticky note with the caret already in it.

**String clues together** with the Draw Connection tool (click one clue, then another; it stays on
so you can tie several in a row) or by dragging straight from a clue's pushpin. Cut a string by
selecting it and pressing Delete, or right-clicking it. Strings take the colour of the pin they
start from, so a line of enquiry reads as one colour across the board.

**Set clues aside** with Delete or the right-click menu. They go to the **Discarded** tray and come
back with every string they were tied to still attached — dismissing is never destructive.

**Close a case** with the box icon in the header; it moves to Archived and can be reopened. A GM
also gets a trash icon, in the header and on each row of the sidebar, which destroys the case and
everything on it after a confirmation that says how many clues go with it.

**Filter** the board to find things. Non-matching clues *dim* rather than disappear, so the layout
never moves: a board is a spatial memory, and "the watch is bottom-right, next to the map" should
stay true.

### Keyboard

The board can be worked without a mouse. With the cork focused: **arrows** pan (hold Shift to go
further), **+**/**−** zoom, **0** resets. With a card focused: **Enter** opens it, **L** starts a
string and Enter on another card finishes it, **Delete** sets it aside. **Escape** unwinds whatever
is in progress, one step at a time.

## Sharing

A case starts out belonging to whoever made it. How it gets shared depends on one quirk of
Foundry's permission model, which is worth understanding:

**Foundry's server refuses a non-GM any change to a document's ownership after it exists** — but it
*permits* setting it at the moment of creation. So:

- **Choosing "the whole party" when you create a case needs no GM at all.** This is the path to
  prefer.
- **Changing who can see a case afterwards needs a GM or Assistant GM online.** The Share dialog
  relays the request to their client, which re-checks that you own the case before applying it.

A case's own player always keeps it, and every GM always keeps access, so sharing can never orphan
a case or lock out the only people who could repair it.

## Permissions

| Action | Who |
|---|---|
| Add, edit, move, dismiss clues; string and cut | Anyone with **Owner** on the case |
| View only | **Observer** |
| Create or import a case | Needs **Create Journal Entries** — the **Trusted Player** rank has it by default |
| Share an existing case | **GM or Assistant GM** |
| Delete a clue permanently | **GM only**, from the Discarded tray — players set aside instead |
| Delete a case permanently | **GM only**, from the header or the sidebar — players close instead |

**Recommended setup: give your players the Trusted Player rank.** They can then create cases, share
them with the party at creation, and import cases, all without a GM online. Editing clues never
needs one either way — the board works with the GM away.

If a player lacks the permission, a connected GM's client will create the case for them as a
fallback, but that means waiting for a GM to be online.

**On GM-only deletion:** the guard runs on the client attempting the delete, so it stops every path
through the interface and any accident. It cannot stop a player deliberately calling the API from
the browser console — Foundry grants an Owner delete rights, and revoking those would mean relaying
every clue edit through a GM and breaking offline-GM play. Players get **Set aside** and **Close
case**, which keep everything recoverable.

Image upload needs **Upload Files** (Assistant GM by default). Without it, the image picker falls
back to browsing existing files or pasting a path.

## Moving a case between worlds

**Export Case** writes a JSON file; **Import** reads one back. The board itself travels — clues,
where they sit, the strings between them, and the discarded tray. Ownership and links to documents
do not: both are meaningless in another world, where those users and documents don't exist.

## How it is stored

A case is an ordinary **JournalEntry** flagged as one. Each clue and each string is a
**JournalEntryPage** of a module sub-type.

That is deliberate: ownership, folders, compendium export, permissions and multi-client sync all
come from Foundry core rather than being rebuilt. It also means two players moving different clues
never collide, because they are writing to different documents.

Dragging a clue writes **one** update, when you let go — not one per pointer move — so a board
stays usable over a network. Who is holding which card travels over the module socket instead of
the database, and expires on its own if someone disconnects mid-drag.

## Development

Plain ESM, no build step.

```bash
node test/run.mjs              # validates against your own Foundry install
node tools/preview-server.mjs  # a workbench for the board, with no Foundry needed
```

The test harness loads Foundry's own `common/` code, so the manifest and data models are checked by
the same schemas the server uses. It looks for Foundry at `E:/Foundry Virtual Tabletop/resources/app`;
override with `FOUNDRY_APP=/path/to/resources/app`.

With the preview server running, `/tools/preview/case.html` is a full board and exposes in-browser
suites (`runInteractionTests()`, `runLinkingTests()`, `runTrayTests()`, `runDropTests()`,
`runBoardRendererTests()`); `/cards.html` is the template gallery and `/strings.html` the connection
layer.

Releases are cut by pushing a `v*` tag. The workflow refuses to publish if the tag and
`module.json` disagree.

## License

[MIT](LICENSE). The bundled fonts remain under the SIL Open Font License and the textures are CC0 —
see [CREDITS.md](CREDITS.md).
