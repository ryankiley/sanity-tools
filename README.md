# sanity-tools

Batch tooling for a [Sanity](https://www.sanity.io) dataset: bulk image uploads + Claude-powered metadata generation. Local-only; nothing here is deployed. Built for a portfolio site running a `media` schema with `category` / `tag` references, but easy to adapt.

## Setup

```bash
git clone <this-repo>.git
cd sanity-tools
npm install
cp .env.example .env
# Fill in SANITY_PROJECT_ID and ANTHROPIC_API_KEY in .env
npx sanity login   # populates ~/.config/sanity/config.json
```

The Sanity client reads `SANITY_PROJECT_ID` and `SANITY_DATASET` from `.env` and the auth token from `~/.config/sanity/config.json`. The AI scripts read `ANTHROPIC_API_KEY` from `.env`.

## Customization

The scripts assume a Sanity schema shaped like:

- `media` document type with: `title`, `mediaType`, `altText`, `caption` (Portable Text), `image`, `categories[]`, `tags[]`, `featured`, `hidden`, `location` (geopoint), `date`.
- `category` documents with `title` + `slug`.
- `tag` documents with `title` (or `name`).

Most upload scripts have an "Edit before running" block at the top with the constants you'll need to replace (folder paths, category / tag document IDs, etc). Look up the IDs in your Sanity Studio or via:

```js
client.fetch(`*[_type == "category"]{_id, title}`)
```

The AI prompts in `caption-images.mjs` and `rewrite-captions.mjs` are intentionally generic — replace them to match your own voice / project.

## Scripts

### `caption-images.mjs`

Find media docs with no caption, generate one via Claude, patch the doc.

```bash
node caption-images.mjs
```

### `rewrite-captions.mjs`

Walk every non-hidden media doc and rewrite the caption via Claude per the rubric in the script's `SYSTEM_PROMPT`. Resume-safe via `caption-rewrite-progress.json`.

```bash
node rewrite-captions.mjs --dry-run   # preview
node rewrite-captions.mjs              # apply
```

### `generate-local-metadata.mjs`

Scan a local image folder, run each through Claude for title / alt / caption / category / tags, write a metadata JSON file. Resume-safe (the output file is also the resume marker).

Reads from `~/Desktop/export/` and expects `curation.json` inside it (`{ dropped: [{ filename }] }`). Writes `metadata.json` next to it. Edit the `LOCAL_DIR`, `CATEGORIES`, and `TAGS` consts inside before running.

```bash
node generate-local-metadata.mjs
```

### `upload-curated.mjs`

Bulk upload from a curation JSON manifest (filename → metadata). Pulls EXIF and GPS at upload time via Sanity's `extract` option. Auto-creates the `photography` category if it doesn't exist. 5-way concurrency.

Edit `EXPORT_DIR` and `CURATION_FILE` paths at the top of the file before running. Curation JSON shape is documented inside.

```bash
node upload-curated.mjs
```

### `upload-folder.mjs`

Bulk upload every image in a local folder with a fixed category, tag, and (optional) geopoint. 5-way concurrency.

Edit `DIR`, `CATEGORY_REF`, `TAG_REF`, and `GEO` at the top of the file before running.

```bash
node upload-folder.mjs
```

### `upload-metadata.mjs`

Patch existing Sanity assets with metadata from a JSON file (no new uploads). Pairs with `generate-local-metadata.mjs` — reads `~/Desktop/export/metadata.json` by default. 5-way concurrency, resume-safe.

Edit `CATEGORY_IDS` and `TAG_IDS` maps at the top of the file before running so the script knows the document refs to use.

```bash
node upload-metadata.mjs
```
