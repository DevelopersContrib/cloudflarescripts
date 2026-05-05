# Cloudflare Worker Scripts — VNOC Portfolio

This repo holds all Cloudflare Worker lander templates for the VNOC domain portfolio.

## Folder Naming Convention

```
{vertical}-{type}/
├── src/
│   └── worker.js
└── wrangler.toml
```

**Examples:**
| Folder | Worker Name | Description |
|--------|------------|-------------|
| `handyman-community/` | `handyman-community` | Projects + Q&A + Find Contractors lander |
| `handyman-contractors/` | `handyman-contractors` | Paid contractor directory lander |
| `realty-listings/` | `realty-listings` | Property listings lander |
| `veganist-community/` | `veganist-community` | Vegan community lander |

## Structure

```
cloudflarescripts/
├── handyman-community/
│   ├── src/community-worker.js
│   └── wrangler.toml
├── handyman-contractors/
│   ├── src/contractors-worker.js
│   └── wrangler.toml
└── {vertical}-{type}/
    ├── src/worker.js
    └── wrangler.toml
```

## Deploy Workflow

1. Edit worker in `src/`
2. `git add . && git commit -m "..."` — commit to GitHub first
3. `cd {vertical}-{type} && wrangler deploy`

## Rules

- **Always commit to GitHub before deploying to CF**
- One folder per worker type per vertical
- `wrangler.toml` lives at the subfolder root (not repo root)
- Secrets (API keys, tokens) via `wrangler secret put` — never in `wrangler.toml`
- KV namespace IDs are shared across workers of the same vertical

## Accounts

- **CF Account ID:** `04366e6a18a185bcae6be03a3bd99aca`
- **KV Namespace (handyman cache):** `a59dfe352efe42c88d8bc494cb0994f6`
- **VNOC API:** `manage.vnoc.com/v2/domainsite/workerinfo`
