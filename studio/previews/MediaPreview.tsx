import React from "react";
import type { SanityDocument } from "sanity";

// Iframes the live site into the Studio document pane. Passes the
// doc id as ?preview= so the site route can highlight / scroll to /
// activate draft mode for just this item. Runs against local dev or
// whatever SANITY_STUDIO_PREVIEW_URL points at in the deployed Studio.
const PREVIEW_URL = process.env.SANITY_STUDIO_PREVIEW_URL ?? "http://localhost:3000";

export function MediaPreview({ document }: { document: { displayed?: SanityDocument } }) {
  const id = document.displayed?._id?.replace(/^drafts\./, "") ?? "";
  const src = `${PREVIEW_URL}?preview=${encodeURIComponent(id)}`;
  return <iframe src={src} style={{ width: "100%", height: "100%", border: 0 }} title="Preview" />;
}
