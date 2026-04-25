# Migrations (dormant)

Historical one-shot migration scripts. Each one ran against the live Sanity dataset (`sn138nra/production`) at a specific point in time, then was retired because the data shape it targeted no longer exists. **Do not re-run.**

These are kept for reference only — if a future audit wants to know what changed and how, the script is the authoritative record.

## `audit-agency-credits.mjs`

**Originally:** `studio/audit-instrument-credits.mjs` in the portfolio repo (extracted to `sanity-tools` 2026-04-25).

**Purpose:** post-hoc audit fix after the agency-credit migration. Two parts:

1. Upgraded the agency-credit role from `null → "Agency"` on a small handful of items where the migration had created the credit but left the role unset.
2. Trimmed agency-name suffixes (e.g. "…at Instrument", "Designed alongside … Instrument") out of caption text, since the structured `credits[]` field now carries that attribution and the duplication read awkwardly.

**Status:** ran once with `--apply` against production. Done.

## `migrate-agency-to-credit.mjs`

**Originally:** `studio/migrate-instrument-to-credit.mjs` in the portfolio repo (extracted to `sanity-tools` 2026-04-25).

**Purpose:** moved the "Instrument" agency from `client` ref + `tag` ref → structured `credits[role: "Agency"]`. Specifically:

- Upserted a `collaborator` doc named "Instrument".
- For each affected media doc: appended a credit `{ person: <Instrument>, role: "Agency" }`, removed the Instrument tag ref, removed the Instrument client ref.
- Deleted the now-unused Instrument tag doc and client doc.

**From shape:** `{ client: <ref:Instrument>, tags: [..., <ref:Instrument>], credits: [...] }`
**To shape:** `{ client: null, tags: [...], credits: [..., { person: <ref:Instrument-collab>, role: "Agency" }] }`

**Status:** ran once with `--apply` against production. The Instrument tag and client docs no longer exist.

## `migrate-caption-credits.mjs`

**Purpose:** parsed plaintext collaborator names out of caption text and converted them into structured `credits[]` entries on the media doc. Replaced the older convention where credits were embedded in caption prose (e.g. "Designed with Andrew Chee").

**From shape:** caption text containing collaborator phrasing; empty `credits[]`.
**To shape:** structured `credits[{ person, role }]`; caption text with the credit phrasing trimmed (where appropriate).

**Status:** ran once against production. The credit-in-caption convention has been retired.

## `migrate-to-single-client.mjs`

**Purpose:** collapsed the legacy `clients[]` array field down to a single `client` ref. Earlier versions of the schema allowed multiple clients per media item; the post-migration schema enforces a single end-client (with agencies/studios moved to `credits` per the `migrate-agency-to-credit` migration above).

**From shape:** `{ clients: [<ref>, <ref>, ...] }`
**To shape:** `{ client: <ref>, clients: undefined }`

**Status:** ran once against production. The `clients[]` array field no longer exists in the schema.
