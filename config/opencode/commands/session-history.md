---
description: Ask natural-language questions about your opencode session history and costs
---

Answer this question about the user's opencode session history:

> $ARGUMENTS

## Data source

Every opencode session is recorded as one JSON file in `~/.opencode-sessions/`.
List them with `ls ~/.opencode-sessions/` and read individual files with `cat`.

Per-date cost rollup (pre-computed):

!`~/.config/opencode/bin/cost-history`

## JSON shape — each file

```
{
  "sessionID": "ses_xxxx",
  "slug": "short-mnemonic",
  "title": "Human-readable summary of what the session did",
  "models": [
    {
      "model": "accounts/fireworks/models/glm-5p2",
      "provider": "fireworks-ai",
      "agent": "05-glm-5p2-plan",
      "cost": 0.0207,
      "tokens": { "input": 9514, "output": 353, "reasoning": 663, "cacheRead": 20680, "cacheWrite": 0 }
    }
  ],
  "totalCost": 0.0925,
  "directory": "/Users/joel/src/dotfiles",
  "createdAt": 1789335617088
}
```

`createdAt` is a Unix timestamp in milliseconds.

## Answer patterns

- **Most expensive sessions**: Extract `totalCost` from each file with `rg -o '"totalCost": [0-9.eE+-]+' ~/.opencode-sessions/*.json`, sort descending, then `cat` the top files to get `title` + `slug`. Report title, slug, cost, and date.
- **What did I work on [time period]**: Convert `createdAt` (unix ms ÷ 1000 → seconds) to a calendar date, filter to the requested period, list `title` + `slug` + `totalCost` for matching sessions.
- **Model X cost vs model Y**: `cat` each file and sum `models[].cost` grouped by `models[].model`. Report a comparison table.
- **Total spend**: Sum `totalCost` across all files, or read the TOTAL row from the rollup table above.
- **Sessions for this project**: Filter by `directory` matching the output of `pwd`.

## Edge cases

- **`totalCost: 0`**: Typically auto-permissions reviewer sessions or sessions that just started. Exclude from "most expensive" lists unless the user asks for all sessions.
- **`title: "Untitled"` or empty**: No summary was captured. Report `slug` instead and note the title was unavailable.
- **`directory` not matching current project**: Sessions from other projects or temp dirs (e.g. `/private/var/folders/.../opencode-auto-permissions/reviewer`) appear in the global list. If the user asks about "this project", filter by `pwd`. Otherwise label sessions from other directories.
- **`model: "unknown"`**: Incomplete early records. Group separately, not with real models.

You are a read-only subagent. Do not edit files. Use only `cat`, `ls`, `find`, `grep`/`rg`, `head`, `tail`, `wc`, and `pwd`. Report concisely with a table or list. Always include session title (or slug), cost, and date in per-session results.
