# AuricIDE Brand Kit

> The definitive visual identity guide for AuricIDE — an AI-native desktop IDE with a futuristic, dark-mode-first design language.

---

## 1. Brand Identity

| Attribute    | Value                     |
| ------------ | ------------------------- |
| Product Name | **AuricIDE**              |
| Package Name | `auric-ide`               |
| App ID       | `com.auricide.ide`        |
| Tagline      | **AI Native**             |
| Description  | AI-native Markdown editor |
| Version      | 0.1.0                     |

### Brand Philosophy

AuricIDE merges a **heads-up-display (HUD) aesthetic** with the precision of a professional code editor. The visual language evokes advanced cockpit instrumentation — dark backgrounds, neon accent glows, translucent glass panels, and sharp typographic hierarchy. Every element serves the user's focus: ambient environmental information at the periphery, content front and center.

### Name Treatment

The brand name is rendered as two typographic segments:

- **AURIC** — Space Grotesk, Black weight (`font-black`), tight tracking, white
- **IDE** — Space Grotesk, Light weight (`font-light`), wide tracking (`tracking-[0.1em]`), `primary-light` color (`#d66aff`)

The logotype stands alone. "AI Native" is the project's **tagline in prose and press
material only** — it is deliberately not rendered under the logo in the app, and
`Header.test.tsx` has a standing test asserting the sticker never appears. Do not
build it into a lockup.

---

## 2. Logo

### Construction

The logo is a **512 × 512 SVG** consisting of three layered elements:

1. **Outer Hexagon Frame** — Stroke-only hexagon using the primary gradient (`#bc13fe` → `#d66aff`), 12 px stroke, rounded caps & joins.
2. **Stylized "A" Glyph** — Filled triangular letterform centered inside the hexagon, using the same gradient, with a Gaussian blur glow filter (`stdDeviation="12"`).
3. **Inner HUD Detail** — A dashed circle (`r="180"`, `stroke-dasharray="10 20"`, 30 % opacity) and a crosshair motif (four 40 px strokes, white at 50 % opacity).

### Gradient

```
Linear gradient "auric-grad": 0% → 100%, top-left to bottom-right
  Stop 0%:   #bc13fe  (Primary)
  Stop 100%: #d66aff  (Primary Light)
```

### Glow Effect

The "A" glyph uses an SVG filter with `feGaussianBlur` (`stdDeviation: 12`) composited behind the source graphic. This produces the signature neon glow.

### Usage Rules

- Always display on dark backgrounds (`#050508` or darker).
- Minimum clear space: the hexagon stroke width (12 px at native size) on all sides.
- Never rotate, stretch, or recolor the logo.
- In the header UI the logo is displayed at **24 × 24 px** (`h-6 w-6`) inside a **32 × 32 px** container with `bg-white/5`, `border-white/5`, and a purple drop-shadow: `drop-shadow-[0_0_5px_rgba(188,19,254,0.5)]`.
- On hover, the container border transitions to `primary/30`.

---

## 3. Color Palette

> **These are defaults, not constants.** The purple below is the shipped default
> accent, but the app carries five further user-selectable accents — blue, cyan,
> emerald, amber and pink (`[data-accent]` in `src/app/globals.css`) — and a user
> theme JSON under `themes/` can override _every_ token, the git status colours
> included. So treat this chapter as "what AuricIDE looks like out of the box", and
> design assets against it; do not treat any single hex as an invariant the running
> app will honour. The one genuinely fixed mark is `public/logo.svg`, which hardcodes
> `#bc13fe`/`#d66aff` and does not re-theme.

### Primary

| Swatch | Name          | Hex            | Usage                                           |
| ------ | ------------- | -------------- | ----------------------------------------------- |
| -      | Primary       | `#bc13fe`      | Accents, active states, cursor, headings, edges |
| -      | Primary Light | `#d66aff`      | Secondary accent, H2/H3, breadcrumb active      |
| -      | Primary RGB   | `188, 19, 254` | Used for `rgba()` glow & shadow calculations    |

### Backgrounds

| Swatch | Name                 | Hex / Value                                             | Usage                      |
| ------ | -------------------- | ------------------------------------------------------- | -------------------------- |
| -      | Background           | `#050508`                                               | Root body background       |
| -      | Background Secondary | `#0a0a10`                                               | Editor, panels, tooltips   |
| -      | Panel BG             | `rgba(10, 10, 16, 0.7)`                                 | Translucent panel overlays |
| -      | Body Gradient        | `radial-gradient(circle at top left, #12121a, #000000)` | Full page background       |

### Foregrounds

| Swatch | Name             | Hex       | Usage                                 |
| ------ | ---------------- | --------- | ------------------------------------- |
| -      | Foreground       | `#e0e0e0` | Primary text                          |
| -      | Foreground Muted | `#808090` | Secondary text, labels, breadcrumbs   |
| -      | Editor Text      | `#e2e8f0` | CodeMirror default text               |
| -      | Gutter Text      | `#475569` | Line numbers                          |
| -      | Meta / Comment   | `#6a7c8f` | Comments, meta info                   |
| -      | Muted UI         | `#94a3b8` | Placeholder text, punctuation, quotes |

### Borders

| Name          | Value             | Usage                       |
| ------------- | ----------------- | --------------------------- |
| Border Dark   | `#1f1f2e`         | Hard borders between panels |
| Border Subtle | `white/5` (5 %)   | Glass panels, tab dividers  |
| HUD Border    | `white/10` (10 %) | HUD-style element outlines  |

### Hover & Selection

| Name            | Value                       | Usage                     |
| --------------- | --------------------------- | ------------------------- |
| Hover BG        | `rgba(255, 255, 255, 0.05)` | List items, file tree     |
| Active Line     | `rgba(255, 255, 255, 0.03)` | Current editor line       |
| Selection       | `rgba(188, 19, 254, 0.25)`  | Text selection            |
| Search Match    | `rgba(188, 19, 254, 0.25)`  | Find-in-file match        |
| Search Selected | `rgba(188, 19, 254, 0.45)`  | Active find match         |
| Selection Match | `rgba(255, 255, 255, 0.08)` | Matching text occurrences |

### Git / Semantic Colors

| Swatch | Name     | Hex       | Usage                     |
| ------ | -------- | --------- | ------------------------- |
| -      | Added    | `#2effa5` | New / added files & lines |
| -      | Modified | `#ffce2e` | Changed files & lines     |
| -      | Deleted  | `#ff4a4a` | Removed files & lines     |

### Status Colors

| Name         | Hex       | Usage                   |
| ------------ | --------- | ----------------------- |
| Success      | `#22c55e` | Green-400 / Green-500   |
| Error        | `#ef4444` | Red-400 / Red-500       |
| Connected    | `#22c55e` | Connection badge (live) |
| Disconnected | `#ef4444` | Connection badge (off)  |

### Syntax Highlighting Palette

| Token Type               | Color     | Style                             |
| ------------------------ | --------- | --------------------------------- |
| Keyword / Modifier       | `#c084fc` | Bold                              |
| Control / Module Keyword | `#d66aff` | Bold                              |
| Comment                  | `#6a7c8f` | Italic                            |
| String                   | `#86efac` | —                                 |
| Number                   | `#fbbf24` | —                                 |
| Bool / Null              | `#ff9d00` | Bold                              |
| Regexp                   | `#ff7eb6` | —                                 |
| Variable                 | `#e2e8f0` | —                                 |
| Local Variable           | `#93c5fd` | —                                 |
| Function                 | `#60a5fa` | —                                 |
| Property                 | `#93c5fd` | —                                 |
| Class / Type / Namespace | `#fbbf24` | Italic                            |
| Heading (H1)             | `#bc13fe` | Bold, glow, 1.6 em, bottom border |
| Heading (H2)             | `#d66aff` | 1.4 em                            |
| Heading (H3)             | `#e086ff` | 1.2 em                            |
| Emphasis                 | `#93c5fd` | Italic                            |
| Strong                   | `#ffffff` | Bold, subtle text glow            |
| Link / URL               | `#137fec` | Underline                         |
| Inline Code              | `#00f0ff` | Cyan bg tint, 1 px border         |
| List Marker              | `#bc13fe` | Bold                              |
| Tag Name                 | `#bc13fe` | —                                 |
| Attribute Name           | `#93c5fd` | —                                 |
| Attribute Value          | `#86efac` | —                                 |
| Operator                 | `#c084fc` | —                                 |
| Punctuation              | `#94a3b8` | —                                 |
| Invalid                  | `#ff4a4a` | —                                 |

### Semantic NLP Highlighting (Markdown)

This is the one place in the product where the neon palette is deliberately **not**
used. Highlighting sits on top of prose the user is reading, so the marks are muted
and desaturated, carry no glow, and change weight rather than shouting. If you are
adding a mark here, match the restraint — the surrounding chapters do not apply.

Prose also stays prose: word classes (nouns, verbs, adjectives) are never coloured.
Only actionable or factual spans are marked.

**Layer 2 (sync — patterns + wink-nlp NER):**

| Class                            | Color     | Additional Styles                            |
| -------------------------------- | --------- | -------------------------------------------- |
| `.cm-semantic-entity`            | `#b9a3d6` | Weight 500                                   |
| `.cm-semantic-keyword`           | `#d8b06a` | Weight 600                                   |
| `.cm-semantic-prompt-directive`  | `#8fcabf` | Weight 600 — muted teal, "do this"           |
| `.cm-semantic-prompt-context`    | `#93b4d8` | Weight 600 — muted slate-blue, "the setting" |
| `.cm-semantic-prompt-constraint` | `#d8a0b4` | Weight 600 — muted rose, "stay within this"  |

**Layer 3 (async — Transformers.js deep NER):**

| Class                      | Color     | Additional Styles                                             |
| -------------------------- | --------- | ------------------------------------------------------------- |
| `.cm-semantic-deep-entity` | `#a8c0d0` | Dotted underline at 40 % opacity, 3 px offset, 160 ms fade-in |

Entities are **not** colour-coded per type. One calm class covers all of them.

**Layer 4 (async — paragraph intent, line decorations):**

Intent classes carry no text colour — recolouring a whole paragraph would defeat the
purpose. They tint the line's left edge instead, with a gradient that fades out
before mid-line:

`.cm-intent-instruction` · `.cm-intent-explanation` · `.cm-intent-warning` ·
`.cm-intent-question` · `.cm-intent-context`

Values live in `src/app/globals.css`; treat that file as the source of truth for
these eleven classes.

---

## 4. Typography

### Font Stack

| Role    | Family             | Variable         | Fallback                  |
| ------- | ------------------ | ---------------- | ------------------------- |
| Display | **Space Grotesk**  | `--font-display` | `sans-serif`              |
| Code    | **JetBrains Mono** | `--font-mono`    | `ui-monospace, monospace` |

Both fonts are loaded via `next/font/google` with `display: 'swap'` and Latin subset.

### Font Features

```css
font-feature-settings:
  'liga' 1,
  'calt' 1;
font-optical-sizing: auto;
text-rendering: optimizeLegibility;
```

Ligatures and contextual alternates are enabled globally. Subpixel antialiasing is used on the body element.

### Type Scale (Editor)

| Level       | Size   | Weight  | Color     |
| ----------- | ------ | ------- | --------- |
| Heading 1   | 1.6 em | Bold    | `#bc13fe` |
| Heading 2   | 1.4 em | Bold    | `#d66aff` |
| Heading 3   | 1.2 em | Bold    | `#e086ff` |
| Body        | 1.0 em | Regular | `#e2e8f0` |
| UI Label    | 12 px  | Medium  | `#94a3b8` |
| Tagline     | 9 px   | Regular | `#808090` |
| Kbd / Badge | 9 px   | Mono    | `#808090` |

### Weight Usage

| Weight     | Numeric | Usage                                    |
| ---------- | ------- | ---------------------------------------- |
| Light      | 300     | "IDE" in logotype                        |
| Regular    | 400     | Body text, editor content                |
| Medium     | 500     | UI labels, breadcrumbs, semantic actions |
| Bold       | 700     | Headings, keywords, semantic entities    |
| Extra-Bold | 800     | Semantic keywords, prompt directives     |
| Black      | 900     | "AURIC" in logotype                      |

---

## 5. Iconography — the "Auric Line" Set

### Icon System

AuricIDE ships its own inline-SVG icon set. There is no icon font and no
third-party icon package: every glyph is data in
`src/lib/icons/glyphs/*.ts`, rendered by the `AuricIcon` React component
(`src/app/components/ui/AuricIcon.tsx`) or, for raw-DOM contexts like
CodeMirror widgets, by `iconSvgMarkup()` (`src/lib/icons/svgString.ts`).

Names keep the Material Symbols ligature vocabulary (`folder`,
`task_alt`, `smart_toy`, …) so call sites read naturally and swaps stay
mechanical; `ICON_ALIASES` maps synonyms onto shared glyphs.

### Drawing Style

The set was derived from a Recraft-generated style study (see
`docs/assets/icons/`) and is hand-authored for stroke consistency:

| Rule             | Value                                                                                                               |
| ---------------- | ------------------------------------------------------------------------------------------------------------------- |
| Grid             | 24 × 24 viewBox, line work inside x/y ∈ [3, 21]                                                                     |
| Stroke           | 1.5 px, `currentColor`, round caps and joins, no fill                                                               |
| Geometry         | Few primitives; one continuous path beats many fragments                                                            |
| Accent           | **At most one** small filled shape per glyph, `var(--primary)`                                                      |
| Accent placement | The glyph's "live point": folder badge corner, search lens center, terminal cursor, route origin, robot antenna tip |
| No accent        | Utility glyphs (arrows, chevrons, close) and status glyphs                                                          |
| Status glyphs    | Inner mark fills `currentColor` — status color semantics (red error, amber warning) always beat brand color         |

Because line work rides on `currentColor` and the accent on
`var(--primary)`, every icon re-themes live when the user switches the
accent color in Settings → Appearance. This only works inline — never
load these SVGs via `<img>`.

### Size Conventions

`AuricIcon` renders a 1em × 1em box, so font-size utilities size icons:

| Context              | Size               |
| -------------------- | ------------------ |
| Inline / breadcrumbs | 10 px              |
| Default UI           | 14–16 px (text-sm) |
| Activity Bar         | 20–24 px           |

### Color Rules

- Default: `foreground-muted` (`#808090`) or `opacity-70`
- Hover: `foreground` (`#e0e0e0`) or `opacity-100`
- Active: `primary` (`#bc13fe`) or `primary-light` (`#d66aff`)
- The accent primitive always follows `var(--primary)` on its own.

### Adding New Glyphs

1. Pick the family file in `src/lib/icons/glyphs/` (or `status.ts`).
2. Compose the glyph from the builders in `src/lib/icons/types.ts`
   (`p`, `c`, `r`, `l`, `dot`, `cFill`), following the table above.
   `core.ts` holds the reference exemplars.
3. Run `pnpm test:run src/lib/icons/registry.test.ts` — tests enforce
   grid bounds, the one-accent rule, and naming.
4. Check it visually at 14 px on `#050508` before shipping.

### Generating Style Studies (Higgsfield CLI)

For explorations and marketing-scale icon art, the original recipe:

```bash
higgsfield generate create recraft_v4_1 \
  --prompt "Minimalist flat vector UI icon set for a dark futuristic IDE, \
a clean 4x4 grid of 16 line icons, evenly spaced on a very dark background: \
<motif list>. Ultra-thin uniform strokes, geometric shapes, rounded line \
caps and joins, consistent sizing on a shared grid, light gray strokes with \
exactly one small neon purple accent detail per icon, subtle sci-fi HUD \
cockpit feel, no text, no labels, no borders, no glow" \
  --model_type vector --resolution 1k --aspect_ratio 1:1 --wait
```

Known quirks: describe colors **verbally in the prompt** —
combining a long prompt with the `--colors` param falsely trips the
content filter; array params want a JSON literal (`--colors '["#bc13fe"]'`).
`model_type: vector` returns a real SVG. To tokenize a generated sheet:
strip the `<metadata>` C2PA blob, then map near-purple fills →
`var(--primary)`, light grays → `currentColor`, dark cover shapes →
`var(--background)`. Generated output is a style reference — production
glyphs are hand-authored for uniform stroke weight.

---

## 6. Glassmorphism & Effects

### Glass Classes

#### `.glass`

```css
background: rgba(10, 10, 16, 0.6);
backdrop-filter: blur(12px); /* backdrop-blur-md */
border-bottom: 1px solid rgba(255, 255, 255, 0.05);
```

Used for: Header bar, top-level navigation.

#### `.glass-panel`

```css
background: rgba(12, 12, 18, 0.4);
backdrop-filter: blur(4px); /* backdrop-blur-sm */
border-right: 1px solid rgba(255, 255, 255, 0.05);
```

Used for: Side panels, activity bar, file tree.

#### `.glass-card`

```css
background: linear-gradient(145deg, rgba(255, 255, 255, 0.03) 0%, rgba(255, 255, 255, 0.01) 100%);
backdrop-filter: blur(4px); /* backdrop-blur-sm */
border: 1px solid rgba(255, 255, 255, 0.05);
box-shadow: large;
```

Used for: Floating cards, dialogs, command palette.

### Neon Glow

#### `.neon-glow` (Box)

```css
box-shadow:
  0 0 10px rgba(188, 19, 254, 0.4),
  0 0 20px rgba(188, 19, 254, 0.2);
```

#### `.neon-text` (Text)

```css
text-shadow: 0 0 5px rgba(188, 19, 254, 0.6);
```

### HUD Border

#### `.hud-border`

```css
border: 1px solid rgba(255, 255, 255, 0.1);
```

### Cursor Glow

The editor cursor uses a primary-colored glow:

```css
border-left-color: #bc13fe;
border-left-width: 2px;
box-shadow: 0 0 8px rgba(188, 19, 254, 0.6);
```

---

## 7. Spacing & Layout

### Core Dimensions

| Element        | Height / Width | Notes                    |
| -------------- | -------------- | ------------------------ |
| Header         | `h-12` (48 px) | `h-14` (56 px) in canvas |
| Activity Bar   | full height    | Fixed left, icon-width   |
| Tab Bar        | ~36–40 px      | Inline with editor area  |
| Status Bar     | ~24–28 px      | Bottom bar               |
| Default Window | 800 × 600 px   | Opens maximized          |

### Spacing Scale (Tailwind)

| Token     | Value | Usage Examples                              |
| --------- | ----- | ------------------------------------------- |
| `gap-1`   | 4 px  | Tight inline groups                         |
| `gap-1.5` | 6 px  | Breadcrumb items                            |
| `gap-2`   | 8 px  | Icon + label, logo container                |
| `gap-3`   | 12 px | Search button contents                      |
| `gap-4`   | 16 px | Header section spacing, right-side controls |
| `gap-6`   | 24 px | Brand block to breadcrumbs                  |
| `px-3`    | 12 px | Button horizontal padding                   |
| `px-4`    | 16 px | Header horizontal padding                   |
| `py-1`    | 4 px  | Badge vertical padding                      |
| `py-1.5`  | 6 px  | Button vertical padding                     |

---

## 8. Borders & Radius

### Border Radius Scale

| Size   | Value  | Usage                                       |
| ------ | ------ | ------------------------------------------- |
| Small  | 3–4 px | Inline code, scrollbar thumb, search inputs |
| Medium | 6–8 px | Buttons, panels, flowchart nodes, controls  |
| Large  | 12 px  | Logo container, round nodes, cards          |
| Full   | 999 px | Connection badge (pill), stadium nodes      |
| Circle | 50 %   | Status dots, circular nodes                 |

### Border Opacities

| Opacity | `rgba` / Tailwind | Usage                            |
| ------- | ----------------- | -------------------------------- |
| 5 %     | `white/5`         | Glass panels, subtle dividers    |
| 8 %     | `rgba(…, 0.08)`   | Search panel bottom border       |
| 10 %    | `white/10`        | HUD borders, control outlines    |
| 20 %    | `rgba(…, 0.2)`    | Primary tinted borders (buttons) |
| 30 %    | `rgba(…, 0.3)`    | Hover-state primary borders      |

---

## 9. Animations & Transitions

### Keyframe Animations

#### `pulse-soft`

```css
@keyframes pulse-soft {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.7;
  }
}
/* Duration: 3s, ease-in-out, infinite */
```

Used for: Loading indicators, ambient pulse on brand elements.

#### `neon-pulse`

```css
@keyframes neon-pulse {
  0% {
    text-shadow: 0 0 5px currentColor;
  }
  100% {
    text-shadow:
      0 0 20px currentColor,
      0 0 10px currentColor;
  }
}
/* Duration: 3s, infinite, alternate */
```

Used for: Semantic action verbs in NLP highlighting.

#### `react-flow-edge-dash`

```css
@keyframes react-flow-edge-dash {
  to {
    stroke-dashoffset: -10;
  }
}
/* Duration: 0.5s, linear, infinite */
```

Used for: Animated flowchart edges.

### Standard Transitions

| Duration            | Easing  | Usage                                     |
| ------------------- | ------- | ----------------------------------------- |
| 150 ms              | `ease`  | Flowchart node hover (border, box-shadow) |
| 300 ms              | default | Header variant switching, fade-in         |
| `transition-colors` | —       | Icon/text color changes on hover          |
| `transition-all`    | —       | Buttons, search bar hover effects         |

### Entrance Animations (Tailwind)

- `animate-in` + `fade-in` + `slide-in-from-left-2` + `duration-300` — Breadcrumb items
- `animate-ping` — Connection status dot pulse ring

---

## 10. Interactive States

### Hover

- Background lightens: `bg-white/5` → `bg-white/10`
- Border gains primary tint: `border-white/5` → `border-primary/30`
- Text brightens: `foreground-muted` → `foreground`
- Icon opacity: `opacity-70` → `opacity-100`
- Optional neon shadow: `shadow-[0_0_15px_rgba(188,19,254,0.15)]`

### Active / Selected

- Primary background tint: `rgba(188, 19, 254, 0.2)` (autocomplete selection)
- Active line gutter: `bg-white/5`, number color → `#bc13fe`
- Breadcrumb active segment: `text-primary-light` with purple drop-shadow

### Focus

- Input border: `rgba(188, 19, 254, 0.5)`
- Input glow: `box-shadow: 0 0 6px rgba(188, 19, 254, 0.2)`

### Disabled / Muted

- Reduced opacity (50–60 %)
- `foreground-muted` color
- No hover transitions

---

## 11. Component Patterns

### Header

- `.glass` background, `h-12` (48 px), horizontal flex, `px-4`
- Left: Logo (32 px container) + brand text + divider (`h-6 w-px bg-white/10`) + breadcrumbs
- Right: Command palette trigger (search button) + connection badge (pill)

### Activity Bar

- `.glass-panel` background, vertical icon stack
- Active icon: `text-primary`, indicator bar left edge
- Inactive: `text-foreground-muted`

### Tabs

- Background: transparent
- Active tab: bottom border `primary`, text `foreground`
- Inactive tab: text `foreground-muted`, hover `foreground`

### Dialogs / Command Palette

- `.glass-card` styling
- `rounded-lg` (8 px)
- Input fields: `bg-white/5`, `border-white/10`, focus → primary border + glow

### Terminal

- Background: `#0a0a10` (background-secondary)
- Font: JetBrains Mono
- Cursor: primary color

### Cards / Panels

- `.glass-card` for floating elements
- `.glass-panel` for sidebar-docked panels
- All use `backdrop-blur-sm` or `backdrop-blur-md`

### Scrollbar

- Width / Height: 6 px
- Track: transparent
- Thumb: `rgba(255, 255, 255, 0.1)`, 3 px radius
- Thumb hover: `rgba(255, 255, 255, 0.2)`

### Flowchart Nodes

- Background: `#16202c`
- Border: `1px solid #2a3b4d`
- Text: `#e2e8f0`, 13 px, JetBrains Mono
- Hover: border → `rgba(188, 19, 254, 0.4)`, glow shadow

---

## 12. Design Principles

1. **Dark-Only** — No light mode. The entire UI is designed for dark backgrounds (`#050508` base). This is a deliberate brand decision, not a deferral.

2. **Futuristic HUD Aesthetic** — Inspired by cockpit displays and sci-fi interfaces. Dashed circles, crosshair motifs, translucent panels, and neon glows evoke advanced instrumentation.

3. **Neon Accent, Not Neon Overload** — The primary purple (`#bc13fe`) is used sparingly for focal points: cursor, active states, headings, and accents. Most of the UI is neutral to let content breathe.

4. **Glassmorphism as Depth** — Translucent panels with backdrop blur create a layered, dimensional feel without heavy drop shadows. Three tiers: `.glass` (navigation), `.glass-panel` (sidebar), `.glass-card` (floating).

5. **Typography-Driven Hierarchy** — Two fonts only. Space Grotesk for brand and display text; JetBrains Mono for everything else. Weight, size, and color do the work — never decoration.

6. **Minimal Borders, Maximum Clarity** — Borders are near-invisible (`white/5`) by default and only brighten on interaction or to denote active state. The UI feels open and unboxed.

7. **Content First** — The editor occupies maximum screen real estate. Chrome (header, sidebar, status bar) is thin, translucent, and deferential. Ambient information lives at the periphery.

8. **Semantic Color with Purpose** — Every non-neutral color carries meaning: green = added/success, yellow = modified/warning, red = deleted/error, purple = brand/active. No decorative color.

---

_Last updated: 2026-08-11_
