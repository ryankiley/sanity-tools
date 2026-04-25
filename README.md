# sanity-tools

Local batch tooling for the **ryankiley.com** Sanity dataset (`sn138nra/production`). Bulk uploads, AI-powered metadata generation. Scripts are run from the terminal — nothing here is deployed.

## Setup

```bash
git clone https://github.com/ryankiley/sanity-tools.git
cd sanity-tools
npm install
cp .env.example .env  # fill in ANTHROPIC_API_KEY
```

Sanity auth comes from `~/.config/sanity/config.json` (run `npx sanity login` if absent).

## Scripts

### `caption-images.mjs`

Find media docs with no caption, generate one via Claude, patch the doc.

```bash
node caption-images.mjs
```

### `rewrite-captions.mjs`

Walk every non-hidden media doc and rewrite the caption via Claude per the audit rubric. Resume-safe via `caption-rewrite-progress.json`.

```bash
node rewrite-captions.mjs --dry-run   # preview
node rewrite-captions.mjs              # apply
```

### `generate-local-metadata.mjs`

Scan a local image folder, run each through Claude for title / alt / caption, write a metadata JSON file. Resume-safe (the output file is also the resume marker).

Reads from `~/Desktop/export/` and expects `curation.json` inside it (filenames + dropped list); writes `metadata.json` next to it. Edit the `LOCAL_DIR` const inside if you want a different folder.

```bash
node generate-local-metadata.mjs
```

### `upload-curated.mjs`

Bulk upload from a curation JSON manifest (filename → metadata). Pulls EXIF and GPS at upload time via Sanity's `extract` option. 5-way concurrency.

Edit `EXPORT_DIR` and `CURATION_FILE` paths at the top of the file before running.

```bash
node upload-curated.mjs
```

### `upload-folder.mjs`

Bulk upload every image in a local folder with a fixed category, tag, and geopoint. 5-way concurrency.

Edit `DIR`, `PHOTOGRAPHY_CAT`, `LANDSCAPE_TAG`, and `GEO` at the top of the file before running.

```bash
node upload-folder.mjs
```

### `upload-metadata.mjs`

Patch existing Sanity assets with metadata from a JSON file (no new uploads). Pairs with `generate-local-metadata.mjs` — reads `~/Desktop/export/metadata.json` by default. 5-way concurrency, resume-safe.

```bash
node upload-metadata.mjs
```

## Roadmap

Collapse the three AI scripts into a single `metadata.mjs` with mode flags (`--mode=fill|rewrite|local`) and the three upload scripts into a single `upload.mjs` with source flags (`--source=curation|folder|metadata-only`). The current shape works fine; the consolidation is just to reduce the number of constants to edit per workflow.
