# Themes

Drop custom theme JSON files into this folder. AuricIDE scans `themes/` at
startup (and when you click **Reload themes** in Settings → Appearance) and adds
valid files to the picker.

- Built-in themes (Purple, Blue, Cyan, Emerald, Amber, Magenta) always ship
  with the app — you cannot overwrite their ids.
- `*.json` in this folder is gitignored so personal themes stay local.
- Packaged installs also look under the app data `themes/` directory.

## Minimal theme (accent only)

```json
{
  "schemaVersion": 1,
  "id": "rose",
  "name": "Rose",
  "swatch": "#ff4d6d",
  "tokens": {
    "primary": "#ff4d6d",
    "primaryLight": "#ff8fa3"
  }
}
```

Save as `themes/rose.json`, open Settings → Appearance → Theme → **Reload themes**.

## Extended theme (surfaces)

Optional tokens recolor more of the chrome. Anything you omit keeps the default
Auric Neon shell.

```json
{
  "schemaVersion": 1,
  "id": "ink-ember",
  "name": "Ink Ember",
  "description": "Warm ember primary on slightly lifted ink surfaces.",
  "swatch": "#ff6b35",
  "tokens": {
    "primary": "#ff6b35",
    "primaryLight": "#ff9f70",
    "background": "#07060a",
    "backgroundSecondary": "#100e14",
    "surface": "#100e14",
    "foreground": "#f0e8e0",
    "foregroundMuted": "#9a8f88",
    "border": "#2a2430",
    "bodyGradientFrom": "#1a1014",
    "bodyGradientTo": "#050308"
  }
}
```

## Schema (v1)

| Field | Required | Notes |
|-------|----------|--------|
| `schemaVersion` | yes | Currently `1` |
| `id` | yes | kebab-case `[a-z0-9-]`, unique, not a built-in id |
| `name` | yes | Label in the picker |
| `swatch` | yes | CSS colour for the picker dot |
| `tokens.primary` | yes | Primary / neon colour (selection, borders, badges wash) |
| `tokens.primaryLight` | no | **Same hue family** as primary — badge text, light accents on primary washes |
| `tokens.secondary` | no | Optional second accent (e.g. pride pink). Not used for badge-on-primary text |
| `tokens.secondaryLight` | no | Lighter secondary |
| `tokens.background` | no | App background |
| `tokens.backgroundSecondary` | no | Secondary surface |
| `tokens.surface` | no | Cards / panels |
| `tokens.foreground` | no | Main text |
| `tokens.foregroundMuted` | no | Secondary text |
| `tokens.border` | no | Borders |
| `tokens.panelBg` | no | Side panels / chrome (`bg-panel-bg`) — use solid `#000` for true black |
| `tokens.editorBg` | no | Editor / main canvas (`bg-editor-bg`) |
| `tokens.glassBg` | no | Header/toolbar `.glass` strips |
| `tokens.glassPanelBg` | no | Side `.glass-panel` chrome |
| `tokens.hoverBg` | no | Hover wash |
| `tokens.muted` | no | Muted fill |
| `tokens.gitAdded` / `gitModified` / `gitDeleted` | no | Git gutter colours |
| `tokens.bodyGradientFrom` / `bodyGradientTo` | no | Body radial gradient |
| `description` / `author` | no | Metadata only |

Hex colours (`#rgb`, `#rrggbb`) also drive `--primary-rgb` / `--primary-light-rgb`
for glow utilities. Invalid files are skipped; the app keeps running.

## Reserved built-in ids

`purple`, `blue`, `cyan`, `emerald`, `amber`, `pink`
