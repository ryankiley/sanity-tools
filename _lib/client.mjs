/**
 * Shared Sanity client for batch scripts.
 *
 * Reads project + dataset from env (SANITY_PROJECT_ID, SANITY_DATASET).
 * Reads the auth token from `~/.config/sanity/config.json` (populated by
 * `sanity login`) so the same token used by the Studio CLI works here
 * without copying it into .env.
 *
 * If you need a different api version or a read-only variant, call
 * `makeClient({ ... })` with overrides.
 */

import { createClient } from "@sanity/client";
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

// Load .env from the repo root at import time so consumer scripts can
// import this module without manually calling a loader first. ESM
// imports run before the consumer's top-level code, so by the time any
// script body executes, process.env is already populated.
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, "../.env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const eq = line.indexOf("=");
    if (eq > 0) {
      const key = line.slice(0, eq).trim();
      const val = line.slice(eq + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
  }
}

const PROJECT_ID = process.env.SANITY_PROJECT_ID;
const DATASET = process.env.SANITY_DATASET || "production";
const API_VERSION = process.env.SANITY_API_VERSION || "2024-01-01";

if (!PROJECT_ID) {
  throw new Error(
    "SANITY_PROJECT_ID is not set. Add it to .env (see .env.example) before running any script."
  );
}

function getToken() {
  const path = process.env.HOME + "/.config/sanity/config.json";
  try {
    const config = JSON.parse(readFileSync(path, "utf8"));
    return config.authToken;
  } catch {
    throw new Error(
      "Could not read Sanity auth token from ~/.config/sanity/config.json. Run `npx sanity login` first."
    );
  }
}

export function makeClient(overrides = {}) {
  return createClient({
    projectId: PROJECT_ID,
    dataset: DATASET,
    apiVersion: API_VERSION,
    useCdn: false,
    token: getToken(),
    ...overrides,
  });
}

/** Default mutating client used by every batch script. */
export const client = makeClient();
