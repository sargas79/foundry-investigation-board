# Credits and licenses

The module's own code is released under the [MIT License](LICENSE). The bundled assets below keep
their own licenses, which are not affected by that — the fonts in particular remain under the SIL
Open Font License and must stay so, including in any fork.

Every third-party asset bundled with Investigation Board, and its license.

## Fonts

### Caveat
- **Used for:** handwritten notes, sticky notes, margin annotations.
- **Author:** Impallari Type / The Caveat Project Authors
- **Source:** https://github.com/googlefonts/caveat
- **License:** SIL Open Font License 1.1 — full text in [`assets/fonts/CAVEAT-OFL.txt`](assets/fonts/CAVEAT-OFL.txt)
- **Files:** `caveat-latin.woff2`, `caveat-latin-ext.woff2` (variable weight axis, 400–700)

### Courier Prime
- **Used for:** typewritten documents, forensic reports, case files.
- **Author:** Alan Dague-Greene / Quote-Unquote Apps
- **Source:** https://github.com/quoteunquoteapps/CourierPrime
- **License:** SIL Open Font License 1.1 — full text in [`assets/fonts/COURIER-PRIME-OFL.txt`](assets/fonts/COURIER-PRIME-OFL.txt)
- **Files:** `courier-prime-400-latin.woff2`, `courier-prime-700-latin.woff2`,
  `courier-prime-400-italic-latin.woff2`, plus matching `-latin-ext` subsets

Both fonts are bundled as the **latin** and **latin-ext** woff2 subsets only (about 199 KB total).
`styles/fonts.css` is generated from the Google Fonts CSS and carries the matching `unicode-range`
declarations, so browsers fetch only the subset they need.

## Textures

`assets/textures/cork.svg`, `paper.svg` and `wood.svg` are **original works** created for this
module and dedicated to the public domain under
[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).

They are not photographs — each is a small SVG that generates its texture procedurally with
`feTurbulence` filters. That keeps them a few kilobytes each, resolution-independent, and seamless
when tiled (`stitchTiles="stitch"`).

## Icons

Pin and UI icons are drawn inline as SVG, or come from **Font Awesome Free**, which ships with
Foundry VTT itself — this module bundles no icon files of its own.
