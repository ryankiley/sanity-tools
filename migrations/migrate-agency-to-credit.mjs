/**
 * Migrate "Instrument" from tag + client → credit (role: Agency).
 *
 * USAGE:
 *   node migrate-instrument-to-credit.mjs --report
 *     → Prints counts: how many media docs reference the Instrument
 *       tag and/or client. No writes.
 *
 *   node migrate-instrument-to-credit.mjs --dry
 *     → Walks the affected docs and logs the patches that would be
 *       applied (credit add, tag remove, client remove). No writes.
 *
 *   node migrate-instrument-to-credit.mjs --apply
 *     → Apply the migration:
 *         1. Upsert a `collaborator` doc named "Instrument".
 *         2. For each affected media doc:
 *            - Append a credit { person: <Instrument>, role: "Agency" }
 *              (skip if a credit for that person already exists).
 *            - Remove the Instrument tag ref from tags[].
 *            - Remove the Instrument client ref from clients[].
 *         3. Delete the Instrument tag doc and client doc.
 *
 * Auth: uses Sanity CLI token from ~/.config/sanity/config.json.
 */

import { client } from "../_lib/client.mjs";

const args = new Set(process.argv.slice(2));
const MODE = args.has("--apply") ? "apply" : args.has("--dry") ? "dry" : "report";

const INSTRUMENT_NAME = "Instrument";
const INSTRUMENT_URL = "https://www.instrument.com";
const CREDIT_ROLE = "Agency";

// ─── Helpers ───

function slugify(name) {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 96);
}

// ─── Discovery ───

async function findTaxonomyDocs() {
  const [tagDoc, clientDoc, collaboratorDoc] = await Promise.all([
    client.fetch(`*[_type == "tag" && title == $name][0]{_id, title}`, { name: INSTRUMENT_NAME }),
    client.fetch(`*[_type == "client" && name == $name][0]{_id, name}`, { name: INSTRUMENT_NAME }),
    client.fetch(`*[_type == "collaborator" && name == $name][0]{_id, name}`, {
      name: INSTRUMENT_NAME,
    }),
  ]);
  return { tagDoc, clientDoc, collaboratorDoc };
}

async function findAffectedMedia(tagId, clientId) {
  const refs = [tagId, clientId].filter(Boolean);
  if (refs.length === 0) return [];
  return client.fetch(
    `*[_type == "media" && (
      ($tagId != null && references($tagId)) ||
      ($clientId != null && references($clientId))
    )]{
      _id, title, tags, clients, credits
    }`,
    { tagId: tagId ?? null, clientId: clientId ?? null }
  );
}

// ─── Report ───

async function report() {
  const { tagDoc, clientDoc, collaboratorDoc } = await findTaxonomyDocs();

  console.log("Instrument taxonomy docs:");
  console.log(`  tag:          ${tagDoc ? tagDoc._id : "(none)"}`);
  console.log(`  client:       ${clientDoc ? clientDoc._id : "(none)"}`);
  console.log(`  collaborator: ${collaboratorDoc ? collaboratorDoc._id : "(will create)"}`);

  const media = await findAffectedMedia(tagDoc?._id, clientDoc?._id);

  const taggedOnly = media.filter(
    (m) =>
      tagDoc &&
      (m.tags ?? []).some((t) => t._ref === tagDoc._id) &&
      !(clientDoc && (m.clients ?? []).some((c) => c._ref === clientDoc._id))
  );
  const clientOnly = media.filter(
    (m) =>
      clientDoc &&
      (m.clients ?? []).some((c) => c._ref === clientDoc._id) &&
      !(tagDoc && (m.tags ?? []).some((t) => t._ref === tagDoc._id))
  );
  const both = media.filter(
    (m) =>
      tagDoc &&
      clientDoc &&
      (m.tags ?? []).some((t) => t._ref === tagDoc._id) &&
      (m.clients ?? []).some((c) => c._ref === clientDoc._id)
  );

  console.log(`\nAffected media items: ${media.length}`);
  console.log(`  tagged only:       ${taggedOnly.length}`);
  console.log(`  client only:       ${clientOnly.length}`);
  console.log(`  tagged AND client: ${both.length}`);
}

// ─── Dry / Apply ───

async function migrate(apply) {
  const { tagDoc, clientDoc, collaboratorDoc } = await findTaxonomyDocs();
  const affected = await findAffectedMedia(tagDoc?._id, clientDoc?._id);

  console.log(
    `${apply ? "Applying" : "Dry run:"} migration across ${affected.length} media doc(s).\n`
  );

  // Step 1: upsert Instrument collaborator.
  let collaboratorId = collaboratorDoc?._id;
  if (!collaboratorId) {
    const doc = {
      _type: "collaborator",
      name: INSTRUMENT_NAME,
      slug: { _type: "slug", current: slugify(INSTRUMENT_NAME) },
      url: INSTRUMENT_URL,
    };
    if (apply) {
      const created = await client.create(doc);
      collaboratorId = created._id;
      console.log(`+ collaborator "${INSTRUMENT_NAME}" → ${collaboratorId}`);
    } else {
      collaboratorId = "dry-instrument-collab";
      console.log(`[dry] create collaborator "${INSTRUMENT_NAME}"`);
    }
  } else {
    console.log(`= collaborator "${INSTRUMENT_NAME}" exists → ${collaboratorId}`);
  }

  // Step 2: patch each affected media doc.
  for (const m of affected) {
    const hasTag = tagDoc && (m.tags ?? []).some((t) => t._ref === tagDoc._id);
    const hasClient = clientDoc && (m.clients ?? []).some((c) => c._ref === clientDoc._id);
    const alreadyCredited = (m.credits ?? []).some((c) => c?.person?._ref === collaboratorId);

    const patch = client.patch(m._id).setIfMissing({ credits: [] });

    if (!alreadyCredited) {
      patch.append("credits", [
        {
          _type: "credit",
          _key: `migrated-instrument-${m._id.slice(-8)}`,
          person: { _type: "reference", _ref: collaboratorId },
          role: CREDIT_ROLE,
        },
      ]);
    }
    if (hasTag) {
      patch.unset([`tags[_ref=="${tagDoc._id}"]`]);
    }
    if (hasClient) {
      patch.unset([`clients[_ref=="${clientDoc._id}"]`]);
    }

    const actions = [
      alreadyCredited ? "credit=(already)" : "+credit",
      hasTag ? "-tag" : null,
      hasClient ? "-client" : null,
    ]
      .filter(Boolean)
      .join(" ");

    if (apply) {
      await patch.commit();
      console.log(`✓ ${m._id} (${m.title ?? "untitled"}): ${actions}`);
    } else {
      console.log(`[dry] ${m._id} (${m.title ?? "untitled"}): ${actions}`);
    }
  }

  // Step 3: delete the Instrument tag and client docs.
  if (tagDoc) {
    if (apply) {
      await client.delete(tagDoc._id);
      console.log(`\n- deleted tag ${tagDoc._id}`);
    } else {
      console.log(`\n[dry] delete tag ${tagDoc._id}`);
    }
  }
  if (clientDoc) {
    if (apply) {
      await client.delete(clientDoc._id);
      console.log(`- deleted client ${clientDoc._id}`);
    } else {
      console.log(`[dry] delete client ${clientDoc._id}`);
    }
  }

  console.log(`\nDone.${apply ? "" : " (no writes — rerun with --apply)"}`);
}

// ─── Entry ───

if (MODE === "report") {
  await report();
} else {
  await migrate(MODE === "apply");
}
