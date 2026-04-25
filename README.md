# sanity-tools

Local batch tooling for the **ryankiley.com** Sanity dataset (`sn138nra/production`). Lives outside the portfolio repo so the portfolio stays focused on the deployed product.

These are shell scripts run from the terminal — nothing here is deployed. Auth is the Sanity CLI token from `~/.config/sanity/config.json` (run `npx sanity login` if not present) and an `ANTHROPIC_API_KEY` for the AI scripts.

## Setup

```bash
git clone https://github.com/ryankiley/sanity-tools.git
cd sanity-tools
npm install
cp .env.example .env  # then fill in ANTHROPIC_API_KEY
```

## Active scripts

### `caption-images.mjs`

Find media docs with no caption, generate one via Claude, patch the doc.

```bash
node caption-images.mjs
```

### `rewrite-captions.mjs`

Walk every non-hidden media doc, rewrite the caption via Claude per the audit rubric. Resume-safe (`caption-rewrite-progress.json`).

```bash
node rewrite-captions.mjs --dry-run   # see what would change
node rewrite-captions.mjs              # apply
```

### `generate-local-metadata.mjs`

Scan a local image folder, run each through Claude for title/alt/caption, write a metadata JSON file. Resume-safe (output file is also the resume marker).

Currently hardcoded to `~/Desktop/vsco-export/`; edit the `LOCAL_DIR` const inside if you want to point at a different folder. (A flag-based version is on the consolidation roadmap — see "Pass 2" below.)

```bash
node generate-local-metadata.mjs
```

### `upload-curated.mjs`

Bulk upload from a curation JSON manifest (filename → metadata). Pulls EXIF/GPS at upload time via Sanity's `extract` option. 5-way concurrency.

Edit `EXPORT_DIR` and `CURATION_FILE` paths inside before running.

```bash
node upload-curated.mjs
```

### `upload-folder.mjs`

Bulk upload every image in a local folder with a fixed category, tag, and geopoint. 5-way concurrency.

Edit `DIR`, `PHOTOGRAPHY_CAT`, `LANDSCAPE_TAG`, `GEO` consts inside before running.

```bash
node upload-folder.mjs
```

### `upload-metadata.mjs`

Patch existing Sanity assets with metadata from a JSON file (no new uploads).

```bash
node upload-metadata.mjs
```

## `migrations/`

Dormant historical migrations against past data shapes. **Do not re-run.** Kept for reference only — see `migrations/README.md`.

## Roadmap (Pass 2 — consolidation)

The current shape is "Pass 1" of the extraction: lift verbatim from the portfolio repo, drop agency-specific names. A follow-up pass collapses the AI scripts into a single `metadata.mjs` (`--mode=fill|rewrite|local`) and the upload scripts into a single `upload.mjs` (`--source=curation|folder|metadata-only`). Until that lands, treat each script as a standalone tool with its own constants to edit at the top.
