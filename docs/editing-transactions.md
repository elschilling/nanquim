# Editing transactions and Undo/Redo

This document defines Nanquim's in-memory editing boundary for the `v0.1`
beta. It describes application History, not a persisted command log. Native SVG
files store normalized document state; New and Open replace the session and
start with empty Undo and Redo stacks.

## The transaction boundary

An interactive command may collect pointer, terminal, selection, or dialog
input before it is ready to change the document. During that phase it may draw
helpers or previews, but those nodes must be marked transient and must not be
treated as persistent geometry. Cancelling or rejecting the input removes the
preview and leaves History, the dirty revision, and both spatial indexes
unchanged.

Once all input has been validated, the command passes one deterministic
mutation object to `editor.execute()`. `History.execute()` runs that mutation
before changing either stack. Only a successful execution:

- receives the next History ID;
- enters the Undo stack;
- clears the existing Redo branch; and
- advances `DocumentState` exactly once.

The lower-level DOM and manager changes run with mutation observation
suppressed for the duration of the History operation. This prevents one user
transaction from becoming several dirty revisions merely because it inserted,
removed, and styled multiple SVG nodes.

If `execute()`, `undo()`, or `redo()` throws, History leaves both stacks and the
ID counter in their prior state and propagates the error. A mutation command is
therefore responsible for making its own multi-node apply or restore path
failure-atomic; it must not partially change the document and then report a
failure.

## Geometry and command sessions

The command registry is the shared entry point for terminal text, aliases, the
tool palette, keyboard repeat, and future command surfaces. Starting a known
command first disposes the previous command session. The cancellation boundary
gives every registered cleanup listener a chance to run and then normalizes the
editor's drawing, selection, and interaction flags even when one listener
fails.

Each session also receives a revision token. Callbacks scheduled through the
session-aware command helper run only while their originating token is current,
and the multi-step asynchronous viewport command rechecks it after every
awaited input before creating helpers or committing a mutation. A cancelled
viewport-capture continuation or guarded delayed cleanup cannot therefore
overwrite the interaction state established by its successor.

Commands declare whether they are available in Model Space, Paper Space, or
both. The tool palette, Help, and central runner consume the same declaration;
individual entry points must not invent a different mode policy.

Completed geometry mutations preserve their original destination parents and
semantic attributes through Undo/Redo. Bounds-changing operations invalidate
both the selectable and full spatial indexes. Redo reuses the same normalized
objects rather than starting a second interactive command or allocating a new
identity.

A single grip gesture is also one transaction, even when it updates several
selected elements or several geometry types. Pointer movement may update the
live preview without dirty tracking; pointer release synchronously commits one
composite command. If any child update fails, every previewed child returns to
its exact pre-gesture state and no History or dirty revision is recorded.

Grouping preserves drawing order by requiring one shared parent, placing the
new group at the earliest selected sibling, and retaining the selected
children's document order. Mixed-parent grouping is rejected rather than
silently changing coordinate systems. Ungroup currently accepts only ordinary
groups without a transform or group-level presentation styling; groups that
would change appearance when flattened receive an unsupported diagnostic and
remain unchanged.

BLOCK applies a stricter preflight to the complete selection tree. Every
selected element must share one parent in the active drawing, and the selected
nodes, their ancestors up to the drawing root, and all descendants must have no
non-identity SVG or CSS transform. The definition receives clones in source
sibling order and the instance replaces the earliest selected slot without
collapsing intervening unselected siblings. Undo restores every source to its
exact parent/index and restores the user's original selection order; Redo
reuses the same definition and instance identities.

### Transformed grips, snaps, and intersection tools

Grip pointers are expressed in the active SVG root, while element geometry is
stored in each element's local coordinate system. Nanquim converts through the
complete screen transformation matrices before applying an edit, including
transforms inherited from nested groups. Ortho constrains the visible point in
root space first, then each coincident element receives its own local target.
Paper viewport grips remain in the Paper root because their persisted geometry
is not stored on the temporary SVG selection wrapper.

The same root/local distinction applies to snapping. Endpoint, midpoint,
center, quadrant, nearest, and supported intersection candidates are converted
through the complete element transform for lines, arcs, ellipse arcs, splines,
and other qualified primitives. Intersections use world-space segments. A
Block instance exposes its insertion point and measurable bounding-box corners
as endpoint targets; referenced shadow-tree geometry is not traversed as if it
were editable instance content. Spline nearest snap is sampled rather than an
analytic curve solution.

Interactive SPLINE fit points apply Ortho from the last committed point. The
live curve preview refreshes from the current pointer when Ortho or snapping is
toggled, so the preview and stored `splineData` use the same constrained point.
DIMLINEAR and DIMALIGNED show a transient baseline and their live measured
value while the second extension origin is chosen. This active-command feedback
is attached directly to the viewport, so the optional F3 overlays can remain
hidden; accepting the point hands off to the dimension-line placement preview,
and cancellation removes the transient group. The active dimension style can
set DIMLINEAR geometry to Horizontal, Vertical, or Aligned; the choice is
persisted with the style and redraws dimensions that reference it. The style's
Position setting places dimension text Above or Below the dimension line in
both the live preview and committed geometry. DIMALIGNED is an explicit command
and remains aligned regardless of the orientation style default.

MIRROR accepts an existing selection immediately and asks for the first axis
point. With no selection, select the objects and press Enter first. Both axis
points can snap to the source or other drawing geometry. The reflected preview
uses the current snapped point, including when Snap is toggled with F9 or the
toolbar without moving the pointer. Axis-point clicks do not select nearby
objects. Editing handles stay hidden through axis input and the delete-source
prompt, including when zooming or refreshing the viewport. Semantic splines are
rebuilt from their reflected fit points so the visible path and `splineData`
remain identical through commit and Undo/Redo.

When a non-uniform or skew transform turns a circle or circular arc into a
non-circular curve, the circle-only intersection, tangent, and perpendicular
solvers do not return an unsafe target. Direct transformed snap points remain
available where their geometry is defined. ROTATE composes its drawing-root
rotation through each selected element's complete affine ancestry, preserving
the element's local geometry and specialized metadata. It rejects an own CSS
transform that cannot be composed safely or a non-invertible ancestor matrix
before History mutation. SCALE may compose a transform on a selected group or
Block instance that has untransformed ancestors, but rejects transformed
primitives and any selection inside a transformed ancestor. MIRROR rejects any
selected element with its own transform or a transformed ancestor before it
creates preview clones.

TRIM boundary selection supports individual clicks and selection rectangles:
left-to-right windows include fully enclosed elements, while right-to-left
crossing rectangles also include intersecting elements. Rectangles add to the
chosen boundaries; clicking a boundary again removes it. Press Enter to confirm,
or press Enter with no boundaries to use Auto-Trim. Confirmation and cancellation
clear boundary highlights and any unfinished selection rectangle. A selected
semantic spline is sampled as its finite visible curve when trimming a line;
the preview and committed endpoint use the same intersection.

EXTEND also accepts Enter with no selected boundaries to scan visible Model
geometry automatically. Circular-arc targets can extend to the nearest valid
point on another finite semantic arc; the result retains the source circle and
sweep direction, and its three editable points round-trip through Undo/Redo.

TRIM and EXTEND currently reject a transformed target or boundary, and FILLET
rejects transformed lines and rectangles, with an explicit terminal diagnostic before
calculation or History mutation. HATCH excludes transformed leaves from its
local-coordinate boundary graph. It rejects and re-arms when the click lies in
a transformed scope, a detected untransformed region overlaps one, or the
transformed bounds cannot be qualified; transformed geometry that is provably
remote does not prevent an ordinary hatch. These guards are documented support
boundaries, not claims that the operations were performed approximately.
When every preselected element is a rectangle, HATCH bypasses point tracing and
creates one immediate History mutation from their exact rectangle outlines.
Rounded `rx`/`ry` corners remain elliptical SVG arc commands, multiple selected
rectangles share one pattern-backed hatch, and transformed or non-finite
rectangles are rejected before mutation. With no rectangle-only preselection,
the existing click-inside boundary workflow remains active.
After a successful FILLET, the command returns to selection and stays active
until Escape. Selecting one rectangle applies the radius to all four corners
while preserving the semantic `<rect>` and its metadata; radius zero removes
its rounded-corner attributes. The radius cannot exceed half the shorter side.
Two selected lines retain the line-and-arc workflow. Every completed rectangle
or line pair is frozen into a separate History entry so Undo and Redo remain
deterministic across a repeated session.
JOIN accepts same-parent untransformed lines, open polylines, circular and
elliptical arcs, splines, and single-subpath open SVG paths whose endpoints form
one connected, non-branching chain, up to 1,000 selected elements and 10,000
curve segments. All-linear chains become one polyline; a chain containing a
curve becomes one SVG path whose line, quadratic, cubic, and arc commands are
preserved exactly, including when a source must be reversed. The result uses
the earliest source style and replaces the sources at their earliest document
position. Source-specific arc/spline edit metadata cannot describe a mixed
path and is therefore removed from the result;
Undo restores every original node, selection, and sibling position. Gaps,
branches, closed or multi-subpath sources, non-curve elements, mixed parents,
locked or generated content, and transformed geometry are rejected before
mutation.
OFFSET has the same explicit-policy approach: its qualified path covers
untransformed lines, open or explicitly closed polylines, circular arcs,
circles, and square-corner rectangles. Polyline offsets use mitered corners,
preserve open/closed topology, and reject degenerate, self-intersecting, or
collapsed results before History mutation.
Arc offsets remain concentric and preserve the three defining edit points plus
trimmed-circle metadata when present. An inward arc or circle offset must leave
a positive radius. Transformed geometry, degenerate arcs, rounded rectangles,
and other element types are rejected before ghosting or mutation.

### Delete and clipboard paste

Delete and Erase canonicalize a selection to its outermost selected roots, so
selecting both a group and one of its descendants removes the group only once.
The transaction records every exact node, parent, sibling index, and the prior
selection. Execute, Undo, and Redo either complete for the whole set or restore
the prior structural state after a failure. Selection is cleared only after a
successful removal, and both spatial indexes are invalidated. Paper viewport
deletion is rejected with a bounded message until the Paper viewport controls
have an equivalent removal transaction.

Clipboard SVG is bounded, parsed, sanitized, reference-remapped, and given a
scoped stylesheet before any candidate enters the live document. Paste assigns
canonical IDs and names to its persistent scope wrappers as well as remapping
imported IDs, so Undo/Redo reuses the same nodes and the same reference graph.
Native save, reopen, and resave therefore retain exact canonical bytes for the
qualified clipboard workflow. A pending asynchronous Clipboard API read
captures both the command-session revision and a document-state token. If a
new command starts, New/Open replaces the document, or the captured revision,
name, or file association changes before the read resolves, the paste is
cancelled rather than entering a different editing context.

Model and Paper selection are isolated at the collection/index boundary. Model
Space exposes leaves only from visible, unlocked Model collections and excludes
Paper annotations. Paper Space exposes only visible, unlocked Paper viewport
groups and annotations; it never selects referenced Model geometry through a
viewport. Element-level hidden/locked state is honored recursively on both
surfaces. Locking visible Model content prevents selection but deliberately
does not remove it from Model boundary discovery; hiding it removes it from
that discovery graph as well.

Paper viewport creation stores semantic state rather than treating a detached
JavaScript wrapper as document data. Undo removes the live viewport; Redo
rehydrates the same id, dimensions, scale, origin, visibility, and lock state
into a fresh `PaperViewport`, then reconnects its group/frame selection back to
that new object. Failed removal restores the exact applied object and DOM. A
failed staged document adoption likewise reinstalls the exact prior viewport
objects, nodes, listeners, selection, Paper collection entry, and configuration.

## Other persisted state

Not every persisted UI change is currently an Undoable CAD command. The beta
boundary is explicit:

| Area | History behavior |
| --- | --- |
| Drawing, modify, grouping, block, paste, and viewport creation commands | One completed command transaction with deterministic Undo/Redo. Interactive collection remains outside History. |
| Geometry Nodes graph and modifier mutations | Manager commands use the shared History path. Generated output is a derived cache and is rebuilt rather than edited as ordinary geometry. |
| Properties inspector edits and collection/style settings | Persisted changes mark `DocumentState` dirty, but inspector field edits and collection activation/locking are not individual Undo entries yet. |
| Model and Geometry Nodes view navigation | The saved view is marked dirty when it changes; pan and zoom are not placed in CAD History. |
| Paper viewport navigation and Paper configuration | Persisted changes mark the document dirty. Explicit viewport create and grip-edit commands use History; viewport removal, continuous pan/scale, and configuration controls do not add individual History entries yet. |
| Appearance, command-palette layout, Help, selection, and other local UI state | Never enters the document, History, or dirty state. |

This distinction prevents misleading partial Undo behavior while keeping every
serialized change protected by the dirty/save lifecycle. A future conversion
of a direct state edit into History must add symmetric apply/restore tests and
must not create a second dirty revision.

## Verification

The registry-wide contracts in
`tests/command-lifecycle-contracts.test.js` exercise every command's declared
mode and repeated cancellation behavior. High-risk geometry cases add concrete
supported and unsupported outcomes plus Undo/Redo and spatial-index checks.
`tests/core-document-state.test.js` protects the failure-atomic stack and dirty
revision rules. Focused transformed-geometry, BLOCK, viewport, surface
isolation, runner, and terminal suites protect the support boundaries above,
including `tests/transformed-intersection-guards.test.js`,
`tests/hatch-transform-policy.test.js`,
`tests/remaining-transactional-mutations.test.js`,
`tests/create-viewport-command.test.js`,
`tests/model-drawable-isolation.test.js`, `tests/command-runner.test.js`, and
`tests/terminal.test.js`.
On Fedora 44, Chromium 151.0.7922.137 and Firefox 154.0 each
pass all ten production workflows: typed rectangle creation, actual pointer
selection, Move/Undo/Redo, moved-rectangle Rotate/Undo, repeated cancellation,
sanitized clipboard paste,
exact native save/reopen/resave, Paper annotation hover/click/disambiguation
and Move/Undo/Redo with parsed SVG export, Help keyboard navigation, and
Geometry Nodes evaluation. The remote current/previous Chromium and
stable/ESR Firefox matrix also passes. The direct persistent-handle workflow,
Safari/WebKit check, and remaining
[browser qualification](browser-support.md#release-qualification-record) and
[release-process](release-process.md) checks are not implied by those local
results.

Coverage policy, local commands, fixture mechanics, and browser artifacts are
documented in [Testing and coverage](testing.md).
