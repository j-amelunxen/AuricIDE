# Usage Plugins

This directory is how AuricIDE learns what a CLI's usage records look like and
what its tokens cost — without recompiling, and without touching the app for a
price change.

A plugin answers two questions:

1. **Where are the records?** (`source`)
2. **What did they cost?** (`pricing`)

Everything else — walking the files, deduplicating turns, bucketing them into
windows, adding them up — is the app's job and is the same for every plugin.

> **You do not have to bring your own.** A `claude-code` manifest is compiled
> into the binary from `src-tauri/src/cc_usage/default-manifest.json`, so a
> fresh clone can already read its own usage. A file named `claude-code.json`
> in any scanned directory replaces it wholesale — that is how you apply a
> price change today rather than at the next release.
>
> Like `dynamic-providers/`, the JSON files here are **not tracked in git**
> (`.gitignore`): they describe rates and paths for your machine, not
> repository content. Only this README is tracked. The compiled-in default
> deliberately lives with the Rust source instead, because a build that read
> it from an ignored directory would fail on a fresh clone.

## Where the files are read from

At startup AuricIDE scans **five** directories, in this order, and a later one
wins over an earlier one for the same plugin `id`:

1. `usage-plugins/` (relative to the working directory)
2. `../usage-plugins/`
3. `<app data dir>/usage-plugins/`
4. `<bundle resource dir>/usage-plugins/`
5. `<executable dir>/usage-plugins/`

Running from the repo (`pnpm tauri:dev`) picks up #1/#2 — this folder. The
installed `/Applications` build does not; put overrides in
`~/Library/Application Support/com.auricide.ide/usage-plugins/`.

## Starting a local override

Copy the compiled-in default and edit it:

```bash
cp src-tauri/src/cc_usage/default-manifest.json usage-plugins/claude-code.json
```

Changing a rate in that copy is enough — it wins over the built-in on the next
launch. Changing the file in `src-tauri/` instead changes what everyone gets
and needs a rebuild.

## When a file is rejected

The config is parsed strictly: one missing field fails the **whole file**, and
the plugin simply never appears. There is no toast for this — the reason goes
to stderr as `CC usage: failed to parse usage plugin <path>: <error>`. If a
plugin you wrote is missing, run from a terminal and read that line.

An unknown `source.type` fails the file too, rather than being skipped. A
plugin that loaded but could never find a record would be worse: it would
report zero and look like an answer.

## Schema

```json
{
  "id": "claude-code",
  "name": "Claude Code",
  "manifestVersion": 1,
  "source": {
    "type": "claude-jsonl",
    "roots": ["~/.claude/projects"]
  },
  "pricing": {
    "currency": "USD",
    "cache": { "write5m": 1.25, "write1h": 2.0, "read": 0.1 },
    "serverTools": { "webSearchPerThousand": 10.0, "webFetchPerThousand": 0.0 },
    "models": [
      {
        "id": "claude-opus-5",
        "label": "Opus 5",
        "aliases": ["opus"],
        "rates": [{ "inputPerMTok": 5.0, "outputPerMTok": 25.0 }],
        "fastRates": [{ "inputPerMTok": 10.0, "outputPerMTok": 50.0 }]
      }
    ]
  }
}
```

### `source`

| Field   | Meaning                                                                  |
| ------- | ------------------------------------------------------------------------ |
| `type`  | Only `claude-jsonl` today: one JSONL file per session, one record a line |
| `roots` | Directories to walk. `~/` is expanded against the user's home            |

Adding a second source shape means Rust code (a reader in `scan.rs`), not just
a file. The manifest can only describe sources the app already knows how to
read.

### `pricing.cache`

Multipliers on the **input** rate, not the output one — a cached token is an
input token that was either also stored (a write) or not recomputed (a read).

| Field     | Meaning                                       | Anthropic's value |
| --------- | --------------------------------------------- | ----------------- |
| `write5m` | Writing to the 5-minute cache costs this much | `1.25`            |
| `write1h` | Writing to the 1-hour cache                   | `2.0`             |
| `read`    | Reading from either                           | `0.1`             |

### `pricing.serverTools`

Anthropic-hosted tools bill per request, not per token, so they cannot ride the
token maths. Optional — omitted means both are free.

### `pricing.models`

| Field       | Required | Meaning                                                             |
| ----------- | -------- | ------------------------------------------------------------------- |
| `id`        | yes      | The canonical model string. Matched after normalization (see below) |
| `label`     | yes      | What the panel shows                                                |
| `aliases`   | no       | Other strings the same model appears under                          |
| `rates`     | yes      | Ordered; see **Dated rates**                                        |
| `fastRates` | no       | Fast mode is the same model at a different price                    |

**Model strings are normalized before matching:** a `[...]` suffix is stripped
and the string is lowercased. So `claude-opus-5[1m]` matches `claude-opus-5` —
the 1M-context variant is the same model at the same price, and treating the
suffix as a distinct model would leave that traffic unpriced.

**Aliases matter more than they look.** Older Claude Code versions wrote bare
`opus` / `sonnet` / `haiku`, and dated ids like `claude-haiku-4-5-20251001`
still appear. Without the alias those turns land in the report as an unpriced
model.

### Dated rates

`rates` is an ordered list, and the first entry whose `until` still covers the
day of the record wins. `until` is an **exclusive** `YYYY-MM-DD` bound; an
entry without one matches every day and therefore belongs last.

```json
"rates": [
  { "until": "2026-09-01", "inputPerMTok": 2.0, "outputPerMTok": 10.0,
    "note": "introductory pricing through 2026-08-31" },
  { "inputPerMTok": 3.0, "outputPerMTok": 15.0 }
]
```

This exists because introductory pricing is real and a 30-day report can span
its end. **Every record is priced by the day it happened**, not by today's
price list — otherwise a price change would silently rewrite history.

## A model with no rate

A model the price list has never heard of is not dropped and is not priced at
zero and forgotten. Its **tokens are still counted**, its cost stays zero, and
its name is listed under "no rate" in the panel with a note that the total
understates. A missing rate should read as a gap in the price list, never as a
cheap model.

Adding it is one entry in `models` — no rebuild, no restart of anything but the
app.

## What a plugin cannot change

The reporting windows (24 h / 3 d / 7 d / 30 d), the bucket widths, and the
deduplication rule are the app's, not the plugin's. They are the same question
asked of every source, and a plugin that answered it differently would produce
a report that could not be compared with another plugin's.
