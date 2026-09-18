# Investigation Board

A corkboard for collaborative investigation in **Foundry VTT V14**. Players pin clues, string them
together, and work cases as a party — no GM required at the table.

> **v0.0.1 is an early test build.** The board renders and you can pin evidence; most interaction
> still lands in later milestones. See [Status](#status) for exactly what works today.

## Installation

Paste this manifest URL into Foundry's **Add-on Modules → Install Module**:

```
https://github.com/sargas79/foundry-investigation-board/releases/latest/download/module.json
```

Then enable **Investigation Board** in your world's module settings.

## Opening the board

Three ways, all equivalent:

- The thumbtack button at the bottom of the **token scene controls**
- **Shift+I**
- `game.modules.get("investigation-board").api.open()` from a macro

## How a case is stored

A case is an ordinary **JournalEntry** flagged as one. Each clue and each connecting string is a
**JournalEntryPage** of a module sub-type.

That design is deliberate: ownership, folders, compendium export, permissions and multi-client sync
all come from Foundry core rather than being rebuilt. It also means two players moving different
clues never collide, because they are writing to different documents.

To create a case by hand for testing, make a Journal Entry and set the flag:

```js
const entry = await JournalEntry.create({name: "The Ashwood Murders"});
await entry.setFlag("investigation-board", "isCase", true);
await entry.setFlag("investigation-board", "status", "active");     // active | hold | cold | solved
await entry.setFlag("investigation-board", "progress", 68);          // 0-100
await entry.setFlag("investigation-board", "classification", "Homicide");
```

Creating cases from the UI arrives in milestone 5.

## Permissions

Verified against the V14 source, and worth knowing before you hand cases to players:

| Action | Who can do it |
|---|---|
| Add, edit, move, dismiss clues; link and unlink | Anyone with **Owner** on the case journal |
| View only | **Observer** |
| Create a case | Needs the **Create Journal Entries** permission, which defaults to **Trusted Player** |
| Share a case with another player | **GM or Assistant GM only** — Foundry forbids players changing ownership |
| Permanently delete a clue or case | **GM only** (players archive and dismiss instead) |

**On the GM-only delete:** the guard runs on the client attempting the delete, so it stops every
path through the interface and any accident. It cannot stop a player who deliberately calls the API
from the browser console — Foundry grants an Owner deletion rights, and revoking those would mean
relaying every clue edit through a GM, which would break playing with the GM offline. Players get
**Set aside** instead, which keeps the clue and all its connections recoverable.

Two consequences worth planning around:

- Clue editing needs **no GM online** — the board works with the GM away.
- Sharing always needs a GM or Assistant GM. Promoting players to **Trusted** removes the
  GM-online requirement for *creating* cases, but not for sharing them.
- Image upload needs the **Upload Files** permission (defaults to Assistant GM). Without it the
  image picker falls back to browsing existing files or pasting a path.

## Status

Built so far (v0.0.1 shipped the first group; the rest is on `main`):

- The board window: case sidebar, header, corkboard, floating toolbar, inspector panel
- Pan (drag the cork or middle-drag) and zoom (wheel), remembered per case
- All seven card templates — polaroid, mugshot, profile, document, letter, sticky note, map
- Connection strings with sag, colour, dashed/dotted styles and labels
- Live sync — another player's changes patch your board in place
- **Pin Evidence** creates clues; **Create Lead** drops a sticky note you type straight into
- Drag clues to move them, double-click to edit, right-click for actions
- Drag an Actor, Item or Scene from the sidebar onto the cork to pin a linked clue
- **Set aside** clues to the discarded tray and recover them, strings and all

Not yet implemented (milestones 4–7): drawing and cutting connections, the filter, the inspector
panel's contents, creating and sharing cases from the interface, export/import.

Progress is tracked in the
[issues](https://github.com/sargas79/foundry-investigation-board/issues), grouped under one epic per
milestone.

## Development

No build step — it is plain ESM, loaded directly by Foundry.

```bash
node test/run.mjs          # validates the manifest and data models against your Foundry install
node tools/preview-server.mjs   # a workbench for the board's look, with no Foundry needed
```

The test harness loads Foundry's own `common/` code, so the manifest is checked by the same schema
the server uses at install time. It looks for Foundry at `E:/Foundry Virtual Tabletop/resources/app`;
override with `FOUNDRY_APP=/path/to/resources/app`.

With the preview server running: `/tools/preview/case.html` is a full board, `/cards.html` the card
gallery, `/strings.html` the connection layer. Each page exposes an in-browser check suite
(`runBoardRendererTests()`, `runBoardViewTests()`, `runStringLayerTests()`).

## License

This module is released under the [MIT License](LICENSE).

The bundled fonts and textures carry their own licenses — the fonts are SIL Open Font License 1.1
and the textures are CC0. Both are listed in [CREDITS.md](CREDITS.md).
