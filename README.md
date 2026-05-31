# sanity-tools

![Sanity v5](https://img.shields.io/badge/Sanity-v5-F03E2F?style=flat-square&logo=sanity&logoColor=white) ![Node 20+](https://img.shields.io/badge/Node-20%2B-339933?style=flat-square&logo=node.js&logoColor=white) ![License: MIT](https://img.shields.io/badge/License-MIT-blue?style=flat-square)

Sanity Studio + batch tooling for a [Sanity](https://www.sanity.io) dataset. The Studio under `studio/` is a real Sanity Studio app (deployed to sanity.studio); the scripts at the root are local-only batch tools (bulk image uploads, Claude-powered metadata generation). Built for a portfolio site running a `media` schema with `category` / `tag` references, but easy to adapt.

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

## Studio

`studio/` is a Sanity Studio (React app) — schema definitions, custom structure, field actions, custom previews. Deployed to sanity.studio via `cd studio && sanity deploy`. Independent `package.json` — install separately:

```bash
cd studio
npm install
npx sanity dev      # local Studio at http://localhost:3333
npx sanity deploy   # publish to <studioHost>.sanity.studio
```

### TypeGen for a sibling app

The Studio's `sanity.cli.ts` includes a typegen config that scans your app source for GROQ queries and writes a `.ts` types file. Defaults to a sibling-checkout layout:

- `SANITY_TYPEGEN_PATH` — glob pattern for source files (default: `../../portfolio/{app,server}/**/*.{ts,tsx,vue}`)
- `SANITY_TYPEGEN_GENERATES` — output path (default: `../../portfolio/types/sanity.types.ts`)

Override via env if your app is checked out elsewhere. Typical invocation from the consuming app's root:

```bash
cd ../sanity-tools/studio && npx sanity schema extract --path=./schema.json && npx sanity typegen generate
```
