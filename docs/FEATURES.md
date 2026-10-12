# OpenCalque: features and roadmap

What the app does today, the ten big features chosen to do next and where each stands, and the longer backlog. For how things are built, see [ARCHITECTURE.md](ARCHITECTURE.md).

Last updated: 2026-10-10.

## 1. What exists today

### Drawing
- Lines, rectangles, ellipses and arcs (an ellipse with a start and an end angle), polylines and polygons, straight or curved through their points, text.
- Exact sizes while drawing: a bar above the tools takes typed lengths, angles, widths and heights, and the shape shows its sizes as you draw.
- Walls defined by centerline and thickness, joined cleanly at any angle where their ends meet. A run of walls closes with a double-click.
- **Curved walls**: a wall bent into an arc by dragging the handle in its middle or typing its curve. It joins its neighbours, takes doors and windows, bounds rooms and is measured round its curve.
- Doors and windows that snap onto a wall, cut the opening, adapt to the wall's thickness and slide along it. Door type, hinge side, angle; window panes, glazing, sill.
- Stairs: straight, L-shaped, U-shaped, spiral, each with its own parameters. A compass rose for north.
- Dimensions with configurable line, end markers, extension lines, text, font, unit and decimals; and a separate measure tool that only reads a distance.
- Text typed directly on the drawing, on several lines; double-click a text to change it. **Fields** (`{date}`, `{page}`, `{page-number}`, `{pages}`, `{document}`) are filled in when drawn and exported.
- **Line style**: weight chosen as printed millimetres, kinds of line (dashes, dots), and arrows or other ends on lines and polylines; a bar above the tools sets the style of the next shapes.
- **Eyedropper**: copy the look of an object to the selection or to the next shapes.
- **Align and space evenly**, and the common properties of several selected objects edited together.
- A guide line across the view while a segment is exactly horizontal or vertical, and a hint bar with the keys that matter for the tool in use.
- Lengths shown and typed in millimetres, centimetres, metres, inches, feet, or feet and inches (7' 6 1/2").
- **Papers**: sheets like frames, drawn at a standard format (A5 to A0, upright or lying, at a drawing scale) or any size, named above their corner, moved on their own over the drawing to frame it, and copied or duplicated with what is drawn on them.
- Walls stay joined: moving a wall or a corner stretches the walls that meet it, and its doors and windows follow.
- Numbers in the panels change by holding Alt and dragging sideways.
- **Transforming** any selection: turn about a clicked point with the Rotate tool (by a base line, or a typed angle), mirror horizontally or vertically, scale and nudge, by dragging the grips of the selection box, from the menus or the keyboard.
- **Annotations**: a note with a curved, straight or elbowed leader to what it is about, typed in place, with a choice of symbol at each end.
- **Corners**: a wall end is a selectable corner shared by the walls that meet there; drag it and they all follow. A corner of two walls can be mitred, rounded, cut off, or have one wall run through. Each line of a wall (its faces, its ends) can have its own look. A wall is cut in two with the Split tool; the two halves show the line between them.
- **Rooms**: click inside closed walls to name a space; its floor, outline and area follow the walls. **Dividers** split an open space into rooms without a wall.
- **Floor patterns**: a Hatch modifier (lines, planks, tiles) for rooms and any closed shape.
- **Shared colours**: named colours that objects and layers link to; change one and everything linked follows.
- **Wall types**: a thickness, a fill and layers, shared by the walls built as them and drawn as lines inside the wall.
- **Dimension chains** along a wall through its doors and windows, made on demand.
- **Quantities** exported as CSV: room areas, wall lengths, faces less openings and volumes, doors and windows by kind, wall types by layer.
- **Modifiers**: non-destructive changes to how an object is drawn, stacked and applied in order, that can be switched off or removed at any time: crop, hatch, and repeat (copies in rows and columns); extensions can add more.
- Text can be bold and aligned left, centred or right.
- Hints and size fields that follow what you are doing: only the next step and the keys usable right now are shown.
- **Snapping** to the points of objects, the middle of a line, the crossing of two lines, the foot of a perpendicular, the line itself (wall faces and their corners included), and to the grid; angle constraint, drag handles, exact values in the properties panel.
- **Holding a direction**: while drawing or dragging, an arrow key keeps the wall, line, object or point upright or level, and pointing at a point elsewhere ends it level with that point.
- **Splitting** a wall, a line or a polyline with the Split tool, which shows the length on either side of the cut, so a part can be deleted or changed on its own.
- **Smart guides**: what is moved lines up with the sides and middles of other objects and keeps equal gaps with its neighbours, with lines and gap sizes shown while moving.

### Organising a drawing
- Pages, which can be duplicated with their contents and reordered by dragging, and layers with colour, visibility and lock. **On every sheet**: a title, a logo or a north arrow drawn once, in millimetres of paper, shows on every paper at its own scale, in the corner it was drawn nearest to, with fields (`{sheet}`, `{scale}`, `{page}`, `{project}`…) filled in for each sheet.
- **Groups**: several objects treated as one (`Ctrl+G`, `Ctrl+Shift+G`), nestable; double-click to edit inside.
- **Components**: a reusable definition with instances that all update together; double-click an instance to edit the component.
- **Stacking order**: bring forward or send backward one step or all the way, from the properties panel, the right-click menu, shortcuts, or by dragging rows in the object list (several at once when they are selected).
- A Structure panel listing the objects, with an icon per kind of object, expandable groups, lock and hide per object.
- Cut, copy and paste, including between drawings and windows.

### Reusing and extending
- **Component library**: one searchable, illustrated grid of everything that can be placed: doors, windows, stairs and other parametric objects, the drawing's own components, and the warehouse libraries. Door and window also have their own toolbar buttons.
- **Component warehouse**: browse libraries of ready-made symbols (furniture, bathroom, kitchen and electrical ship with the app, named in the app's six languages), search, and click to place. More libraries can come from a catalog published on the web.
- **Extension warehouse**: install extensions that add new parametric objects (electrical symbols, plan annotations and adjustable furniture ship with the app), from the catalog, a web catalog or a file. These extensions are data, not programs, so installing one cannot run code.
- Any drawing can be imported as a component library.

### Working from an existing plan
- Drop a picture, a PDF, a drawing or an extension onto the window and it goes to the right place.
- Import a PDF (any one of its pages) or a picture as a background, set its scale from one known distance, and trace over it.
- Import a DXF: lines, polylines, circles, arcs, ellipses, curves and text on their layers, with their colours and weights; blocks as groups, hatches as fills, dimensions and leaders as dimensions and annotations. A DXF laid out as a sheet (from AutoCAD's paper space or SketchUp LayOut) comes in as a paper at its scale, with what each of its windows shows.

### Assistant
- A chat panel that changes the drawing from a description, through the same validated operations as the rest of the app; one undo per request.
- Conversations are kept and can be reopened from the selector at the top or with `/resume`; pictures can be pasted or attached; the model is chosen below the message; `/new`, `/model`, `/clear`, `/help`.
- Providers: Claude with an API key, Claude through the Claude Code CLI on the computer (desktop), a local model through Ollama, or any OpenAI-compatible service.

### Application
- Desktop app (Windows, macOS, Linux) and web app from the same code, with **installers** built and attached to a GitHub release for each version tag.
- A **welcome window** at start (new drawing, open, recent drawings on desktop, or the bundled example) and an **About** window with the release notes, read from `CHANGELOG.md`.
- In the desktop app on Windows and macOS the menu bar is the window's title bar.
- Menu bar, dockable panels that can be moved, tabbed, floated and closed, a command list (`Ctrl+K`) with every command and rebindable shortcuts, a right-click menu, preferences.
- Autosave to the drawing's file, which can be switched off.
- English, French, Spanish and German.
- Files are readable JSON with a published schema; a command-line tool creates, validates, edits and exports drawings.
- Export to PDF at true scale (one page per paper, with a title block), to SVG and to DXF. Text in any script but Korean prints in the PDF: Chinese, Japanese, Greek, Cyrillic and Central European letters come from fonts shipped with the app, only the glyphs used embedded.

## 2. The next ten big features

Ranked by how much each one moves the app from "promising" to "usable for real work". Status is as of the date above.

| # | Feature | Status |
| --- | --- | --- |
| 1 | **Component warehouse** | **Done.** Bundled libraries, search, click to place, web catalogs. |
| 2 | **Extension warehouse** | **Done** for data-only extensions (new parametric objects). Extensions that add tools or commands still have to be compiled in. |
| 3 | **Groups, stacking order, right-click menu** | **Done.** |
| 4 | **Cut, copy, paste** | **Done**, including across drawings. |
| 5 | **DXF export** | **Done** (lines, circles, text, layers), and DXF import: geometry, blocks (as groups), hatches, dimensions, leaders, and sheets laid out in paper space. Blocks do not become components yet. |
| 6 | **Sheets and printing**: paper size, drawing scale, title block, PDF export to scale | **Done**: papers with format, direction, scale and a title block; vector PDF export at true scale, one page per paper. Views of the plan at another scale on a sheet are in the ideas below. |
| 7 | **More drawing tools**: polyline and polygon tool, arcs and curves, typed lengths while drawing, room areas | **Mostly done**: one line tool for lines, polylines and polygons (a double-click closes the shape), typed sizes, room areas, arcs (by angles) and curved polylines, snapping to middles, crossings, perpendiculars and lines. A tool to draw an arc directly is not started. |
| 8 | **Transforming**: rotate and scale handles, align and distribute, mirror, array | **Mostly done**: rotate (a tool, about a clicked point), mirror, uniform scale and nudge for any selection, from grips on the selection box, menus and shortcuts. Align, distribute, a repeat (array) modifier and smart guides while moving are done; non-uniform scaling is not. |
| 9 | **Walls as a system**: openings that follow their wall, walls trimmed where they meet mid-span, moving a wall drags its neighbours, rooms detected from walls | **Done**, with selectable corners, joint types, wall types and curved walls. |
| 10 | **Hosted version**: accounts, cloud storage, sharing by link, realtime collaboration | Not started. The data model is prepared for it (see ARCHITECTURE §10). |

## Ideas, in the order they seem worth doing

Agreed with the owner in October 2026. The first was built straight away.

**Walls and structure**
- ~~Corners as selectable nodes, joint types~~ (done)
- ~~Reusable wall types with thickness, fill and layers~~ (done)
- ~~Curved walls~~ (done: bent from a straight wall; not yet drawn as an arc with the wall tool, extended or trimmed, or given a dimension chain)
- ~~Automatic dimensions for a run of walls~~ (done, not live); dimensions that follow the wall
- IFC export (walls, slabs from rooms, openings), now that walls have heights and types

**Sheets and output**
- ~~PDF export to scale, with a title block~~ (done)
- Views on a paper: part of the plan, cropped and at another scale (details)
- ~~Quantities as CSV~~ (done); the same tables placed on a sheet
- Levels (storeys), with the one below shown faintly

**Drawing comfort**
- ~~Smart guides: alignment and equal spacing against other objects while moving~~ (done); the same guides while drawing and resizing
- ~~Align, distribute, a repeat ("array") modifier~~ (done); a live mirror modifier
- ~~Snapping to midpoints, perpendiculars and intersections~~ (done, with the nearest point on a line); tangents and the quarter points of circles
- ~~Eyedropper~~ (done)
- Trim, extend and fillet for lines

**Import and sharing**
- ~~DXF import~~ (done, with blocks as groups); blocks as components
- PNG export
- A live demo on GitHub Pages; ~~downloadable installers~~ (done, unsigned); signed installers and automatic updates

**Assistant**
- A preview of its changes to accept or refuse before they are applied
- "Trace this scanned plan": finding the walls in a picture
- An MCP server, so outside agents can drive a drawing

## 3. Backlog, by area

Not ranked within an area.

**Drawing and editing**
- Rich text; angular and radius dimensions; dimensions that follow what they measure.
- Trim, extend, offset and fillet for plain lines (walls have extend and trim); boolean operations on shapes.
- Smart guides while drawing and resizing; snapping to tangents and the quarter points of circles.
- Select similar; select by layer or type; find and replace text.
- Lock aspect ratio; non-uniform scaling; numeric move and copy.

**Architecture**
- Columns, beams, slabs, roofs in plan; curtain walls.
- Curved walls drawn directly with the wall tool, extended and trimmed, and dimensioned along their curve.
- Schedules of doors, windows and rooms placed on a sheet (they are exported as CSV today).
- Sections and elevations linked to the plan.
- More stairs: winders, landings of any shape, handrails, break line.

**Components and extensions**
- Component properties that vary per instance (text, sizes, visibility of parts); swap one component for another; detach an instance.
- Favourites in the component library.
- Publishing: package a library or extension and submit it to a public catalog; versioning and updates for installed extensions.
- Extensions that add tools, commands, panels and import/export formats, loaded at runtime in a sandbox with declared permissions.
- Translations of the extensions' own texts beyond what they carry.

**Import and export**
- DWG import; IFC export; PNG export at a chosen resolution.
- Straighten and crop a scan; trace a scan automatically.

**Assistant**
- Approval before applying changes, with a preview; edit history per request.
- Rendering of formatted replies.
- Tracing an imported plan into walls with a review step; checking a plan against rules (door widths, room sizes).

**Application**
- ~~Dark theme~~ (done); touch and pen input; high-contrast mode.
- Crash recovery; version history.
- Signed installers and automatic updates; file association for `.opencalque`.
- Performance on drawings with tens of thousands of objects (caching per object, then GPU rendering).
- Automated interface tests.
- More languages, right-to-left support.
