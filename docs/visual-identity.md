# Nanquim visual identity

Nanquim keeps the editor-oriented workspace and keyboard-first precision that
made the original prototype productive, while using its own visual language.
The identity is rooted in the project's name: **nanquim**, the technical ink
used for architectural drawings before digital drafting.

## Design idea

The interface should feel like a modern instrument rather than a reproduction
of another application. Its recurring visual cues are:

- technical-pen nib cuts and ink reservoirs;
- construction lines, registration marks, measured ticks, and plotted curves;
- quiet, near-paper surface steps instead of unrelated gray panels;
- restrained color reserved for focus, active tools, and current context;
- compact geometry and typography that remain legible during long CAD sessions.

The existing workspace structure remains familiar: drawing, terminal,
Outliner, Properties, Paper Space, and Geometry Nodes still occupy the same
areas and keep their established interaction model. Visual artwork, color
relationships, borders, elevation, and icon forms are Nanquim-specific.

## Theme system

The three built-in themes pair a desaturated ink accent with a subtly tinted
background:

| Theme | Accent | Background | Character |
| --- | --- | --- | --- |
| Oxide red | `#9b6267` | `#211d1e` | red drafting ink on a warm charcoal sheet |
| Verdigris green | `#5f806a` | `#1c211e` | survey and field-note green on a neutral sheet |
| Blueprint blue | `#607d9e` | `#1d2024` | cool reproduction-blue without saturated UI glare |

Preferences also allows custom accent and background colors. Custom choices
must pass the same input validation as presets, adapt the foreground for light
or dark backgrounds, apply as a preview, and persist only when the user saves
Preferences. Appearance preferences are local UI state and never dirty or enter
the drawing document.

Theme code uses semantic tokens rather than component-specific palette copies:

- `--accent-color` is the active ink color.
- `--app-background-color` is the user-selected base sheet color.
- `--surface-0` through `--surface-4` establish interface depth.
- `--top-rail-bg-color` gives the application menu a near-black instrument
  rail in the built-in dark themes.
- `--canvas-bg-color` establishes the deeper drafting field shared by Model
  Space, Geometry Nodes, and diagram previews.
- Foreground, border, focus, canvas, and overlay tokens derive from the base
  color and its light/dark tone.

Accent color is not the only indicator of state. Active controls retain shape,
contrast, or border cues so that red, green, blue, and custom themes remain
usable for people with color-vision differences.

## Icon grammar

Nanquim icons are project-authored SVG artwork. They use a consistent compact
grid, a technical-pen stroke language, simplified silhouettes, and generous
negative space so they remain recognizable at the application's normal icon
size. Icons inherit `currentColor`; active state coloring therefore comes from
the theme rather than being baked into the artwork.

The artwork remains 20 pixels inside larger interactive hosts: 24 pixels in
editor headers and 28 pixels in the Properties rail. This adds separation and
pointer area without making the symbols heavier.

Interactive icon controls use native button semantics, a visible hover title,
an accessible name, and state attributes such as `aria-pressed` or
`aria-expanded`. Multiple decorative glyphs that represent one action remain a
single control, and their mask spans stay hidden from assistive technology.

Common symbols such as folders, visibility, delete, and search retain their
widely understood meaning. CAD-specific symbols emphasize constructed geometry
and measured marks. The application mark combines a pen nib with a drafting
registration point.

Do not add glyphs copied or extracted from another application's icon sheet.
New symbols should extend the same grid and stroke grammar and receive an
inventory test before use.

## Attribution and continuity

Blender and Pablo Vazquez's browser UI experiments remain openly acknowledged
as important influences on Nanquim's editor-oriented workflow. That historical
influence does not require Nanquim to reuse Blender's expressive artwork or
color scheme. The visual-identity milestone replaces the inherited icon assets
while preserving the functional lessons that inspired the project.
