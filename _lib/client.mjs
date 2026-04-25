/**
 * Shared Sanity client for batch scripts.
 *
 * Reads the CLI token from `~/.config/sanity/config.json` (populated by
 * `sanity login`). Lives here so every one-off script doesn't re-declare
 * the project id, dataset, api version, and token plumbing.
 *
 * If you need a different api version or a read-only variant, call
 * `makeClient({ ... })` directly instead of reusing the default export.
 */

import { createClient } from "@sanity/client";
import { readFileSync } from "fs";

const PROJECT_ID = "sn138nra";
const DATASET = "production";
const API_VERSION = "2024-01-01";

function getToken() {
  const path = process.env.HOME + "/.config/sanity/config.json";
  const config = JSON.parse(readFileSync(path, "utf8"));
  return config.authToken;
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
