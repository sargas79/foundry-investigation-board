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

Every clue records **the character who pinned it** — not the account name, so a board reads as the
party wrote it. The name sits on the card and in the inspector, with the time it was pinned. Both
the actor and the name as it stood are kept, so a rename follows through while a player swapping
character mid-campaign doesn't silently rewrite who found what.

**Jot a lead** with Create Lead — one click drops a sticky note with the caret already in it.

**String clues together** with the Draw Connection tool (click one clue, then another; it stays on
so you can tie several in a row) or by dragging straight from a clue's pushpin. **Hand**, the first
tool in the bar, puts whatever is in use back down: it drops the linking tool, abandons a
half-drawn string and closes the filter panel, leaving the plain pointer you started with. Cut a string by
selecting it and pressing Delete, or right-clicking it. Strings take the colour of the pin they
start from, so a line of enquiry reads as one colour across the board.

**Set clues aside** with Delete or the right-click menu. They go to the **Discarded** tray and come
back with every string they were tied to still attached — dismissing is never destructive.

**Close a case** with the box icon in the header; it moves to Archived and can be reopened. A GM
also gets a trash icon, in the header and on each row of the sidebar, which destroys the case and
everything on it after a confirmation that says how many clues go with it.

**Open the case file** with the folder icon in the header. The board is where the party works a
case out; the file is what they write down — an opening document with a file number and the facts
of the case, then findings pages added as sessions go on. The GM or the case's owner writes the
opening file; anyone who can work the case can add a finding, and edits only their own.

**Redaction** is the GM's. Selecting a passage and redacting it *moves the text out* of the page
into a companion document players have no permission on — so a player's browser has no copy at all,
not merely a hidden one. Revealing moves it back. This matters: neither `gmOnlyFields` nor page
ownership would have done it, because the first only guards writes and the second only filters
display, leaving the text sitting on the player's client either way.

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

**Where uploads go.** Every image uploaded through the board is written to `leads/` inside the
world's own folder — `Data/worlds/<your world>/leads` — whichever directory the picker happens to
be showing, and the folder is created the first time it is needed. Browsing stays unrestricted, so
an image already somewhere in the world can still be picked. One folder inside the world is the
only sensible home for these: Foundry's server refuses an upload into any world but the running
one, a module's own directory is wiped when the module updates, and evidence scattered across
whatever folder each player last opened is no use to the next GM. Images dropped or pasted
directly into a clue's *rich text* body are core's own feature and still go where core puts them,
beside the journal entry.

## Moving a case between worlds

**Export Case** writes a JSON file; **Import** reads one back. The board and the case file both
travel — clues, where they sit, the strings between them, the discarded tray, the opening document
and every finding.

Three things deliberately stay behind. Ownership and links to documents are meaningless in another
world, where those users and documents don't exist. **Redacted passages** are left out on purpose:
they live in a GM-only document precisely so they are absent from anything a player could obtain,
and writing them into a portable file would undo that in a single step. The bars still appear in
the destination world, with nothing behind them.

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
