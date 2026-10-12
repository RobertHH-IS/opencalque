# Changelog

What changed in each version of OpenCalque. The app shows this list under About, and the text of
a version becomes the description of its release on GitHub. Newest first; one `## version — date`
heading per version, then `### New`, `### Improved` or `### Fixed` with one line per change.

## 0.8.5 — 2026-10-12

### New
- Zoom to selection (Shift+2), first in the right-click menu: picked from the list of objects, a thing is brought into view, to see where it is.

### Improved
- Pages are put in order by dragging them in the Pages panel, in place of the up and down arrows.
- Dragging a selected row in the Structure panel takes the whole selection along: the objects arrive together, in the order they had.
- The Export dialog stays open while a PDF is made, saying what it is doing, and Cancel or Esc stops it while a font is still loading, so no file turns up later. Contributed by @Seeker-Star.

### Fixed
- Double-clicking a component to edit it no longer moves the view: it stays where and as large as it was drawn, only the rest of the drawing goes away, and leaving it (Esc or Done) puts everything back where it was.

## 0.8.4 — 2026-10-12

### New
- A button in the toolbar aligns the selected objects (left, centre, right, top, middle, bottom) and spaces them evenly across or up and down.

### Improved
- A paper's panel gives its position (X and Y) at the top and no longer has stacking order, which means nothing for a sheet that is always beneath the drawing.
- The File menu no longer offers the example drawing: it is on the welcome screen, and in the command palette (Ctrl+K).
- A selected paper shows only its scale above it, as "1:100", and the panel no longer lists its width and height in the drawing: its format and scale say what it is.
- The paper's panel no longer has an "Export this sheet as PDF" button: exporting is in the File menu (Ctrl+P), with the other formats.

### Fixed
- Typing a scale for a paper of a size of its own changed what printed instead of what the sheet covers: the frame stayed as it was. It now does what pulling a corner does, for a sheet of any size.

## 0.8.3 — 2026-10-12

### New
- "On every sheet": draw a title, a logo or a north arrow once and it shows on every paper of the drawing. It is drawn in millimetres of real paper, so it keeps its place and its printed size when a paper is moved or its scale changed, and on a sheet of another format each thing stays in the corner it was drawn nearest to. Open it from the panel of any paper; a paper can leave it out. Leaving it brings back the view and the paper one came from.
- New text fields: `{sheet}`, `{scale}` and `{format}` say the name, the scale and the format of each sheet in what is drawn on every sheet, and `{project}`, `{client}`, `{address}` and `{author}` what the drawing says about itself.

### Improved
- Layers no longer have "show on every page": what it put on every page stood at one place in the drawing and did not follow a paper or its scale. "On every sheet" does that job. In a drawing that used it, what was on such a layer now shows only on the page it was drawn on.

## 0.8.2 — 2026-10-12

### New
- A DXF laid out as a sheet, as AutoCAD's paper space and SketchUp LayOut write them, comes in as that sheet: a paper at its scale, what is drawn on it, and what each of its windows shows of the model, at its true size and cropped to the window. LayOut's own layers are found again.
- DXF import reads much more: blocks placed in the drawing (as groups), hatches (as fills, plain or patterned, joined to the outline they fill), curves, filled shapes, dimensions and leaders with their notes (as dimensions and annotations), and the colours, line weights, dashes, fonts and bold of what it reads.
- `opencalque import drawing.opencalque a.dxf b.dxf` on the command line makes one drawing of several DXF files, a page each, with the pictures they refer to.

### Improved
- A `{page}` or `{page-number}` written on a shared layer says the page it is seen on, so one title kept on a shared layer names every sheet.
- Moving a paper no longer moves what is drawn on it: the sheet slides over the drawing, so it can be put where it frames what to print. Copying and duplicating a paper still take along what lies on it.
- Pulling a corner of a paper changes its scale instead of its shape: an A4 stays an A4 and covers more or less of the drawing. The corner keeps to the diagonal, which is shown, and the scale goes by round values (1:20, 1:25, 1:50…). Hold Alt for a sheet of any size.
- A selected paper shows what it is above it, as "A4 · 1:100", instead of its width and height in the drawing.
- Changing the scale or the format of a paper keeps its middle in place, so what it frames stays in the middle of the sheet instead of ending up in a corner.

### Fixed
- Text from a DXF came in a quarter too small, and went out a third too large: a DXF gives the height of a capital letter, not the size of the font.
- Multi-line text from a DXF kept stray formatting codes such as "\l" in front of its words.

## 0.8.1 — 2026-10-12

### New
- The interface in Japanese, chosen under Preferences › Language or followed from the system. The component library, doors, windows and stairs are named in Japanese too.

### Improved
- Japanese text in an exported PDF is drawn with a Japanese font, so its kanji take their Japanese forms rather than the Chinese ones. A text is taken as Japanese when it has kana, or when the app is in Japanese.

## 0.8.0 — 2026-10-12

### New
- The interface in Chinese (Simplified), chosen under Preferences › Language or followed from the system. The component library, doors, windows and stairs are named in Chinese too.

### Fixed
- Exported PDFs print Chinese, Japanese kana, Greek, Cyrillic and the letters of Central and Eastern Europe and Vietnam, which came out as "?". The fonts ship with the app and a PDF carries only the letters it uses; the text can still be searched and copied. Korean is not covered yet.
- A DXF export writes letters beyond plain ASCII (accents included) in the form CAD programs read whatever the language of the computer, instead of letting them turn into other characters; a DXF written that way also imports with its letters intact.

## 0.7.0 — 2026-10-11

### New
- Feet and inches. A new unit in Preferences shows and reads lengths the way American plans do, as 7' 6 1/2", to the nearest half, quarter, eighth, sixteenth or thirty-second of an inch. Type them as you like: 7'6", 7' 6 1/2", 7-6, 90". Dimensions can be shown that way too, and whatever the unit in use, a length typed in feet and inches is understood.
- A Split tool in the toolbar (K): point at a wall, a line or a polyline and it shows where it would be cut, with the length of each part on either side, measured by a line with arrows from each end to the cut (following a curved wall); click to cut it there. The cut keeps to whole grid steps from the start, or to where another object lines up; Alt cuts exactly under the pointer.
- A Rotate tool (E): click the point to turn about, then a second point for the line the turn starts from, then the selection turns with the pointer, the angle shown between the two lines; click to apply, or type the angle. It shares a button with Mirror horizontally and Mirror vertically (the new names of the two flips), which act on the selection at once. The Transform section of the properties is gone: the box around a selection still scales from its corners.
- Split the wall in two, in the Object menu: the wall becomes two, with a corner in its middle (the Split tool cuts it wherever you point). Split it twice and the part in between is a wall of its own, to delete or to change.
- A tap on Space puts down the wall or shape being drawn and goes back to the Select tool, which is usually what comes next; held, Space still moves the view.

### Fixed
- Curved walls joined to another wall, curved or straight, no longer grow a spike, a triangle or a stray corner at the joint: the corner is found where the faces really meet ahead of the joint, not along a tangent nor where a curve crosses the other wall a second time. Two tightly curved walls that leave their joint almost the same way and bend apart (a wall cut in two, then each half curved) meet where their faces cross, and the line drawn between them runs there instead of doubling the cut-off corner.
- The line where two walls meet now takes the colour, weight and kind of line given to it from either wall; before, only one of the two walls was listened to, so a change made from the other seemed to do nothing. Picking a kind of line for an end that had none now shows it at once.
- A selected object with a patterned fill is outlined in blue, its pattern left as it is: the pattern was lit up too and hid the shape.
- The colour window no longer jumps above or below its field when what it shows changes; it stays where it opened and scrolls when it is too tall.
- A click outside the colour window on the name of its row (Colour, under Stroke or Fill) closes it for good: it used to close and open again at once.
- Copying an instance of a component and pasting it into the same drawing made a new component, a copy of the first; it now places another instance of the same component. Pasted into another drawing, separate copies of it share one component there too.
- Angles on the drawing (the angle tool's reading, a rotation) were written as if they were lengths: with lengths in metres, 36° read 0.036°. They are now in degrees whatever the unit.
- A key pressed while a list of the toolbar or a menu of the menu bar is open closes it; a shortcut still does its work, so W with the shapes list open closes it and takes the wall tool.
- Closing a run of walls with a double-click no longer draws a tiny extra wall when the pointer moves a pixel or two between the clicks (snapping could take it to the next grid point or to the face of the wall just drawn), and a slower double-click, as the system counts one, still closes the run.

### Improved
- The Dimension tool shares a button with Text and Annotation.
- The lists of the toolbar's buttons are as wide as their longest name, each on one line, and show the tool in use in the accent colour rather than with a tick in front.
- A double-click on a wall selects the walls joined to it end to end, around a room or along a run, stopping where three walls meet; a second double-click takes in every wall that holds together with it.
- The look of a shape is in two sections that say what they are about: Stroke (colour, weight, kind of line) and Fill. The fill's pattern has rows of its own under its colour: the kind from a row of pictures, "none" first, then its spacing, angle and stroke colour, so a hatched object shows it at a glance; the colour window is a colour window again, without the Plain and Pattern tabs. A wall shows a pattern from its type as inherited, like its other properties, and wall types tick a pattern apart from a fill. Only what applies is shown: a line has no fill, a polygon no ends.
- Closing or opening a polyline, and curving it through its points or straightening it, are commands in the Object menu and the right-click menu, not boxes among its measurements.
- One tool for lines, polylines and polygons. The line tool (L) goes on from point to point: Esc after one segment leaves a line, after several a polyline, and a double-click, or a click back on the first point, closes it into a polygon that can be filled. A click back on the last point, a pixel or two off, ends it rather than adding a tiny segment. The separate polyline tool is gone.
- The welcome window shows the language and the unit, to correct in one click. At a first start the unit follows the computer: feet and inches where plans are drawn in them, millimetres elsewhere.
- The look of a wall can be split line by line: the button beside Stroke in a wall's properties opens its two faces and the line across each end. Pointing at one of them rings that line on the drawing, where it is actually drawn (along the joint at a corner), leaving the line itself in sight. Each takes the wall's colour, weight and kind of line, marked as inherited, until it is given its own, which is marked too, with an arrow to go back to the wall's; "no line" is one of the kinds of line. A wall split in two simply has the line at its cut drawn, at any angle and however the halves are moved afterwards; choose no line there and the two read as one wall again. The corner of two walls has the same choice, Line between them.
- A corner now says what it does. Left alone it is Automatic: a sharp corner, cut off when the walls meet at less than 60°; its picture shows which of the two it is drawing. Sharp corner and Cut off are firm choices that hold at any angle, so a point can be kept on a sharp corner, or a right angle cut off. Drawings open as before: their corners were automatic all along.
- The joint of a corner is picked from small pictures, and a wall's own properties now show how it is finished at its start and at its end, from its own side: automatic, sharp, cut off, rounded, running past the other wall or stopping against it. Choosing there sets both walls of the corner, so they never disagree.
- The joint where "one wall runs past the other" is now right at every angle: the wall that stops is cut flat against the face of the one that passes, with no gap and nothing sticking out, and two walls that nearly carry on from one another meet at their corner with the line between them drawn through it. Before, it was only right at a right angle.
- A double-click now means one thing, going inside what was clicked (a component, a group, a text). It no longer cuts a wall: that is the Split tool.
- The quantities are exported in feet, square feet, cubic feet and inches when lengths are shown in feet or inches.
- The arrow keys hold a direction while dragging too, not only while drawing: with the button down on an object, a wall end, a corner or any point of a shape, the up or down arrow keeps the movement upright and the left or right arrow keeps it level. A point or a corner held this way stops level with whatever is pointed at elsewhere, as a wall being drawn does.

## 0.6.0 — 2026-10-10

### New
- Curved walls. Select a wall and drag the handle in its middle sideways, or type a Curve in its properties: the wall follows an arc through its two ends. It joins the walls at its ends, takes doors and windows, bounds rooms (their area follows the curve) and is measured round its curve in the quantities and in every export. Set Curve to 0 to straighten it.
- Snapping to more than points: the middle of a line, the place where two lines cross, the foot of a perpendicular from where the line being drawn started, and the line itself. A sign and a word beside the pointer say which one it is. The faces of walls and their corners can now be snapped to, so a dimension can be taken from face to face.
- Smart guides: an object being moved lines up with the sides and the middle of the others, and takes the same gap as its neighbours keep between them. Lines show what it is lined up with, and the equal gaps are marked with their size. Where nothing is near, it goes by the grid as before; Alt turns it off.
- Hold a direction while drawing: with a wall, a line, a divider or a polyline started, the up or down arrow keeps it upright and the left or right arrow keeps it level (the same key again lets go). The pointer then only says how far it goes: point at any point elsewhere on the drawing and the wall stops exactly level with it, a dotted line showing what it was taken from. Otherwise it goes by grid steps and stops on a wall it crosses.

### Improved
- The hatching of a fill is no longer something the pointer snaps to.
- Several objects selected together can be dragged from anywhere inside the box around them, the empty space between them included. A plain click there still lets the selection go.

### Fixed
- Windows: with the light theme chosen on a computer set to dark, the minimise and maximise buttons at the top right showed no highlight under the pointer, and dialogs came up dark. The window now always follows the theme of the app.

## 0.5.0 — 2026-10-10

### New
- OpenCalque in a browser, with nothing to install: https://opencalque.com always runs the latest version.
- Quantities: File → Export → CSV writes a table for a spreadsheet with the rooms and their areas, the walls (length, ground covered and, once a wall height is given, the area of their face less doors and windows, and their volume), the doors and windows counted by kind and size, and the wall types layer by layer.
- Wall types, in their own panel. A type defines what you tick, and only that: what the wall is made of ("Plaster 15, Brick 200", or just a material), its thickness, height, fill, outline colour, weight and kind of line. Give a type to walls in their properties or choose it in the bar above the tools; its walls take what it defines, and changing the type changes them all. A wall can still be given a value of its own: it is marked as an exception, with a button to go back to the type. Measured layers are drawn as lines inside the wall.
- Dimension the selected walls (Object menu): a chain of dimensions along each wall, through each side of its doors and windows, with the whole length beyond, on the outside of the plan.
- Patterned fills. The window that chooses a fill now starts with Plain or Pattern: lines, cross-hatch, planks, tiles, dots for concrete, zigzag for insulation, each with its spacing, angle and stroke colour, over the fill's colour. A wall type can define one, so a material is read from its hatching.
- Measure an angle (the arrow beside the measure tool, or Shift+M): click the corner, then a point along each side, and read the angle between them.
- Walls can have a height, and doors and windows too. Nothing of the plan is drawn with them; they are what the quantities measure with.

### Improved
- One Export in the File menu (Ctrl+P or Ctrl+E): a window where you choose the format, PDF, SVG or DXF, then what goes in it, the sheets to print or the page to export.
- One Import in the File menu (Ctrl+I) for everything: a picture or a PDF to trace, a DXF, another drawing for its components, or an extension. The app sends the file where its kind belongs.

## 0.4.2 — 2026-10-10

### New
- A dark theme. Preferences › General › Theme chooses light, dark, or the same as the system (the default); View › Dark theme switches between them. The drawing is shown light on dark too, which can be turned off to keep its paper colours. Exports and printing are never affected.

### Improved
- Shift while dragging the end of a wall or a line now holds it firmly on the line it lies on, at any angle: the grid no longer pulls it off, a dashed line across the view shows the line it is kept on, and the end stops on walls that line crosses. Shift on a corner keeps it on the line of one of its walls.

## 0.4.1 — 2026-10-09

### New
- Walls can be drawn along a face: with the wall tool, the bar above the tools chooses whether the points you click run along the left face, the middle or the right face of the wall. Corners of a run still meet.
- Extend and trim: a wall end runs on to the next wall in its way, or what sticks out past a wall is cut back to it. From the Object menu for the selected walls, or from the right panel for a selected wall end.
- Shift while dragging the end of a wall or a line keeps it on course: the end slides along the line it already lies on, or swings to level, upright or 45°. Shift while dragging a corner moves it along one of its walls.

### Fixed
- macOS: the app no longer opens with "OpenCalque is damaged and can't be opened" on Apple-silicon Macs. It is still not signed by an identified developer, so the first time it has to be opened with a right-click, then Open. There is now a build for Intel Macs as well.

## 0.4.0 — 2026-10-09

### New
- A smarter title block. It is built from what there is to say: an entry left empty takes no room, and the block is only as tall as it needs to be. Each sheet ticks which entries it shows: project, client, address, sheet name, page name, author, scale, format, date, sheet number.
- Project, client, address and author are said once for the drawing and appear on all its sheets; the project is the drawing's name unless you give another. A text too long for its place is set smaller instead of running out of the block.

### Improved
- The example flat is laid out as a flat is: the entrance opens on a hall that serves the living room, the bedroom and the bathroom, and the kitchen is a corner of the living room.
- The points of a selected object (the ends of a wall or a line, the corners of a shape) are round and a little larger, so they read as points to drag; the corners of a selection box stay square.
- Components and library objects are solid: a chair, a table or a cabinet drawn as an outline hides the floor pattern under it instead of letting it show through. Give one a fill of its own to colour it.

### Fixed
- After undoing the move of a wall corner, the blue dot of the selected corner no longer stays where the corner had been dragged.

## 0.3.2 — 2026-10-09

### Improved
- Extensions are installed, removed and switched off on the Extensions page of Preferences; they no longer have a window of their own or an entry in the menu.
- Choosing a colour opens on a picker (a square for how vivid and how bright, a band for the hue, the colour's code to type), then the colours picked lately, then the shared colours, in one window.

## 0.3.1 — 2026-10-09

### Improved
- The ends of a line, a dimension or an annotation, and the kind of line (solid, dashed, dotted…), are picked from a row of pictures instead of a list of names, in the right panel and in the bar above the tools.
- The colour of a layer, and the colour of the next shapes in the bar above the tools, can be linked to a shared colour like any other colour.
- Shared colours have a panel of their own, Colours, beside Structure, instead of sitting under the layers.
- At start, nothing in the welcome window looks selected, and the window's own buttons no longer stand out in white while a window of the app is open.
- Walls meeting at a sharp angle (under 60°) get a chamfered corner by default instead of a long spike. Right angles and wider keep their sharp point.

## 0.3.0 — 2026-10-09

### New
- Import DXF (File menu, or drop the file): lines, polylines, circles, arcs, ellipses and text come in on their layers, in millimetres.
- Arcs: give an ellipse a start and an end angle in the right panel and it is drawn as an arc.
- Curves: tick Curved on a polyline and it flows through its points.
- Repeat (Object menu, or Modifiers): draws an object again in a row, or in rows and columns, without adding objects.
- Text can be bold, and aligned left, centred or right.
- A PDF with several pages asks which page to import.

### Improved
- PDF export includes PNG pictures as well as JPEG ones.
- PDF export prints text in the font that matches its own: sans-serif, serif or monospace, plain or bold, condensed.
- DXF export draws walls that meet in a T as one outline: no line across the end of the wall that stops, and the side it meets is open.

## 0.2.1 — 2026-10-09

### New
- Compass (north) in the component library: a compass rose to place and turn, with its size and letter.

### Improved
- A component or an object is picked by clicking anywhere inside it, even when it is drawn as an outline; a floor pattern underneath no longer takes the click.
- Menus are light, like the rest of the app.
- A lighter toolbar: the zoom reading is in the corner of the drawing beside the pointer's position, the command list is under Preferences (Ctrl+K), and the eyedropper is in the Style section of the right panel (still I on the keyboard).
- The list of a colour field has a width of its own, so its choices are read whole; it opens above the field when there is no room below and stays inside the window.
- Resetting the keyboard shortcuts is offered on the shortcuts page of Preferences only, not in the menu.
- The Objects panel is called Structure and no longer repeats its name under its tab.
- The cross that closes a panel tab is smaller and shows only under the pointer.

## 0.2.0 — 2026-10-09

### New
- Welcome window when the app starts: begin a new drawing, open a file, reopen a recent one (desktop app), or start from the example apartment.
- About window with the version and these release notes.
- Installers: Windows (setup and portable), macOS and Linux builds are attached to each release on GitHub.
- Pages can be duplicated with everything on them, and moved up or down in the list.
- Shared layers: what is drawn on a shared layer shows on every page, for a frame, a logo or a title block.
- Text on several lines. Enter starts a new line; Esc or a click elsewhere finishes.
- Fields in text: {date}, {page}, {page-number}, {pages} and {document} are filled in by the drawing.
- Annotations can run straight or with a square elbow as well as curved.
- Line weights in printed millimetres (0.13 to 1.4 mm), kinds of line (dashed, dotted, dash and dot) and arrows at either end of lines and polylines.
- The bar above the tools sets the colour, weight and kind of line of the next shapes.
- Several objects selected: the properties they have in common are shown and changed together; values that differ read "Mixed".
- Eyedropper (I): click an object to give its look to the selection, or to the next shapes.
- Align and space evenly: six alignments and two distributions, in the right panel.

### Improved
- Preferences can switch the welcome window off.
- Links in the app open in your browser.

## 0.1.0 — 2026-10-09

### New
- First public version: walls that join at any angle, doors, windows and stairs, rooms with areas and floor patterns, dimensions, annotations, papers at scale, components and a component library.
- Selectable wall corners with a choice of joint.
- Shared colours.
- Export to PDF at true scale with a title block, to SVG and to DXF.
- An assistant that edits the drawing from a description, with Claude, a local model or any OpenAI-compatible service.
- English, French, Spanish and German.
- A command-line tool and a published JSON format.
