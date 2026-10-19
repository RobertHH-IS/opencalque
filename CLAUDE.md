# OpenCalque

Free, open-source 2D architectural editor (plans and layouts) with a Figma-like UI. It was called OpenCAD until October 2026: drawings with `"format": "opencad"`, the `.opencad` extension and settings stored under the old name are still read (`FORMER_FORMAT`, `DRAWING_EXTENSIONS`, `apps/web/src/migrate.ts`). Web app first, Electron shell around it.

**Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) before changing anything.** It holds the design, the rules that are easy to break, what is untested, and the next steps. Keep it current when you change the design.

## Commands

```sh
pnpm dev          # desktop app
pnpm dev:web      # editor in a browser
pnpm test         # core tests
pnpm typecheck
pnpm e2e          # builds the web app and drives it in Chromium (Playwright, e2e/*.e2e.ts); runs in CI
pnpm build && pnpm smoke   # scripted interaction test; prints a folder of screenshots to inspect
pnpm dist         # package the installer for this system (apps/desktop/dist)
pnpm schema       # regenerate schema/*.json after changing packages/core/src/schema.ts
pnpm rooms:gallery # draw the plans rooms are tested on, to look them over
pnpm warehouse && pnpm warehouse:gallery # regenerate the bundled component libraries, then draw every symbol on one page
```

Agent terminals have `ELECTRON_RUN_AS_NODE=1`, which breaks Electron. Prefix Electron commands with `env -u ELECTRON_RUN_AS_NODE`.

## Rules

- Documents are immutable and change only through `applyOps` (`packages/core/src/ops.ts`). In the editor, go through `apply` (or `applyOrThrow`) or `preview`/`commit` in `apps/web/src/store.ts`, which keep the operations with each undo step; a core helper that returns a document also returns the `ops` that make it, and those are what the editor applies.
- `packages/core` has no UI or DOM dependency. Keep it that way: the CLI and a future server use it. It is compiled without the DOM's or Node's types, so `pnpm typecheck` catches a slip; what it takes from its host is listed in `packages/core/src/host.ts`.
- The editor talks to its host only through `Platform` (`apps/web/src/platform.ts`). No Electron or Node APIs in `apps/web`.
- Node types draw themselves as primitives (`packages/core/src/kinds.ts`). Do not add type-specific code to the renderers.
- Units are millimetres, Y points down, rotation is in degrees. The tree is `parent` + fractional `order`; there are no child arrays. Groups nest to any depth: move nodes with `moveOps`, and use `rootOf` / `leavesOf` / `holdsChildren` rather than assuming a node's parent is a page.
- The roadmap and feature inventory are in `docs/FEATURES.md`; update the status table there when a feature lands.
- Every text the user sees goes through `t()` from `apps/web/src/i18n.ts` (or `msg()` in tables built at import), written in English, and gets an entry in each file under `apps/web/src/locales/`. `pnpm test` fails if a language is missing one.
- To show or toggle a panel, import from `apps/web/src/dock.ts`, never from `Layout.tsx`.
- Anything only the desktop app can do goes through an optional capability on `Platform` and is checked for (`platform.claudeCli`), so the web build keeps working.
- Every user-triggerable action is a command in `apps/web/src/commands.ts`. Do not add keyboard handling elsewhere (the canvas keeps only Escape, Enter and Space).
- What a tool does on the canvas is a gesture in `apps/web/src/canvas/gestures/` (`PRESSES`, `MOVES`, `RELEASES` in `index.ts`); `CanvasView.tsx` only dispatches. The windows over the editor and the toast are `useWindows` (`windows.ts`), the extensions in use `registry` and `useExtensions` (`extensions.ts`); neither belongs in the store.
- New object types should be parametric objects in an extension unless they need custom editing behaviour. Prefer a declarative (JSON) extension in `packages/warehouse/extensions` (listed in `packages/warehouse/src/index.ts`) when expressions can describe the geometry; never make the app download and run extension code.
- Read a drawing for AI or tooling purposes with `withoutAssets(doc)`: assets are megabytes of base64.
- From 1.0 drawings must stay readable (ARCHITECTURE §4, "The file format and its versions"), and so must extensions written as data (`formatVersion` 1) and operations (README, "What stays stable"). `packages/core/test/drawings.test.ts` keeps what drawings of 1.0 draw: never edit the drawings in `test/fixtures/drawings`; when a change of drawing is meant, accept the new SVG with `pnpm test -u` and say it in the changelog. Read untrusted JSON with `readDocument` / `parseDocument` (`packages/core/src/read.ts`), which keeps unknown properties and repairs what it can; never strip what the schema does not know. An optional property needs nothing more; a new node type or a changed meaning bumps `FORMAT_VERSION` with a step in `MIGRATIONS`.
- `order` is a fractional-indexing key (`isOrderKey`); ops refuse anything else. Leave it out to put a node on top.
- Keep `applyOps` linear: no scan of every node inside one op. Per-drawing indexes (tree, walls, openings, rooms) are cached on `doc.nodes`, which every `applyOps` replaces.
- Values that come from a file, an extension or the assistant (counts, repeats, steps) must be capped where they drive a loop.
- The assistant gets the selection as context (`describeSelection` in `apps/web/src/ai/agent.ts`); keep what the composer's label says and what is sent the same.
- The assistant's agent loop (`apps/web/src/ai/agent.ts`) must stay free of store and DOM imports so it remains unit-testable. Claude is called through the official `@anthropic-ai/sdk`; other providers go through `compatible.ts`.
- Lengths are millimetres in documents and in the store. Convert only at the edge, with `apps/web/src/units.ts` (`formatLength`, `parseLength`, `Field`'s `length` prop); mark length parameters of parametric objects with `unit: 'length'`.
- A provider's `ChatSession` must implement `snapshot()` and accept it back as `history`, without picture data, so conversations can be stored and resumed.
- A paper has no children: what lies inside its rectangle is on it, by position (`paperContents`). Moving or transforming a paper leaves what is on it where it is (the sheet is a frame put over the drawing); only copying, cutting and duplicating take the contents along, through `withPaperContents` in `apps/web/src/actions/clipboard.ts`. Moves on the canvas also add `wallFollowOps` so joined walls stay joined.
- What shows on every sheet (a title, a logo, a north arrow) is one component with a `sheet` size, in millimetres of real paper, which every paper draws over itself at its scale (`templates.ts`, `sheetContent` in `kinds.ts`). There is one per drawing and nothing is chosen per paper, only left out (`plain`). Do not bring back layers shown on every page, nor templates chosen from a list: both were tried and removed. The title block stays separate.
- A room stores a point, never an outline: its floor comes from `roomAt` (`packages/core/src/rooms.ts`) each time it is drawn. Do not cache a room's shape in the document. A room is the space the walls leave as they are drawn; do not go back to rules about which wall ends nearly meet. When a room comes out wrong, add its plan to `packages/core/test/fixtures/rooms` (numbers only, no names) and keep `rooms-robust.test.ts` passing.
- A colour property may be a reference to a shared colour, `var(--<id>)`, or `var(--layer)` (`LAYER_COLOR`), the colour of the node's layer. Resolve it with `resolveColor` (passing the layer's colour) before using it as a colour; never write the resolved value back into a node.
- Modifiers (`packages/core/src/modifiers.ts`) are pure functions from primitives to primitives, run in list order at the end of `nodePrimitives`. Positions in a modifier are relative to its `frame`, which is all that moving and transforming code touches. Never make a modifier read or change the document.
- Hints and the size fields depend on `drawStep` in the store; show nothing that cannot be used at the current step.
- Rotate, mirror and scale nodes with `transformOps` (`packages/core/src/transform.ts`), which asks each type's kind what it means (`transform` in `kinds.ts`, required of every type).
- What can be brought into a drawing (parametric objects, library components) is in the object library (`WarehouseDialog.tsx`); what the drawing holds already is in the Components panel (`Components` in `LeftPanel.tsx`), and only there. A library component is taken `fresh`, a component of the drawing's own each time; only a paste reuses one already there. Keep the words apart: a component is the reusable definition, an instance one placement of it, a parametric object one drawn from its parameters (ARCHITECTURE, "Components").
- Exports (SVG, DXF, PDF) draw from primitives through `paintOrder`; a new kind of primitive or style needs handling in `svg.ts`, `dxf.ts`, `pdf.ts` and `apps/web/src/canvas/draw.ts`.
- The shape of a wall corner (`joins`) and which lines of a wall are drawn (`edges`) are separate settings. Never draw or hide a wall line as a side effect of a joint: go through `endLineShown` / `endLineOps`.
- A wall corner is a position, not a node. Use `wallEndsAt`, `moveCornerOps`, `cornerJoin` and `cornerJoinOps` (`packages/core/src/walls/joints.ts`); how a corner is joined lives on each wall end, in `joins`.
- A dependency added to or updated in what the editor or the desktop app's main process bundles changes `THIRD-PARTY-NOTICES.txt`: run `pnpm notices` (CI checks it). The main process ships no `node_modules`: what it uses is a devDependency of `apps/desktop`, which electron-vite bundles.
- Preferences store only what differs from their defaults (`storedPrefs` in `apps/web/src/prefs.ts`); a new preference needs only its default.
- Every change a user would notice gets a line in `CHANGELOG.md`, under the version being worked on. To release: new `## x.y.z — date` section, same version in every `package.json` (a test checks them all), then push a `vx.y.z` tag; the workflow builds the installers and publishes the GitHub release with that section as its text.
- The desktop menu bar is the window's title bar. Keep its height in step with `titleBarOverlay` in `apps/desktop/src/main/index.ts`.
- A wall type defines only the properties it gives a value to; the user decides which. A wall takes those, and may differ (its own `height` or `style`, or `'thickness'` in its `overrides`). A wall's `thickness` is always stored on the wall and kept in step with its type by `applyOps`: geometry code reads `wall.thickness` and never looks a type up. Heights are for measuring only; nothing is drawn with them.
- An arc is an `ellipse` with `from`/`to`, a curve is a `polyline` with `smooth`: do not add node types for them. Use `arcOf` to know whether an ellipse is an arc.
- What a component holds has no layer, and an instance has no style (format version 2): each placement gives the layer, and with it the colour of what the component leaves uncoloured. `applyOps` refuses both; give new nodes their layer through `layerIn` (core) or `layerHere` (the store), never `activeLayer` directly.
- Doors and windows are tied to walls by position, not by reference. Wall geometry lives in `packages/core/src/walls/` (`index.ts` says which part is where).
- A wall's `a`-`b` is its line, which is its middle only when it has no `justify`; otherwise it is one of its faces. Read where its faces are with `wallSides` (and `wallSpot`, `wallContains`), never as half the thickness each side of `a`-`b`. Doors and windows sit in the middle of the thickness, not on the line.

## Open questions for the owner

- Licence: MIT, confirmed by the owner for 1.0. Installers stay unsigned, also the owner's choice.
- The owner wants a hosted, collaborative version to stay possible. Do not introduce designs that block it (see ARCHITECTURE §10).
