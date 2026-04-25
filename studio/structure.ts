import type { DefaultDocumentNodeResolver, StructureResolver } from "sanity/structure";
import { MediaPreview } from "./previews/MediaPreview";

// Organizes the Studio sidebar:
//   Media           — the primary doc, always at top
//   Taxonomy/       — Categories, Tags, Clients, Collaborators nested
//   Hidden          — pre-filtered view of hidden=true media
//   Recently updated — pre-filtered view sorted by _updatedAt desc
//
// Keeps the default fallthrough so any doc type added later
// (without touching this file) still shows up without needing to
// wire it explicitly.
export const structure: StructureResolver = (S) =>
  S.list()
    .title("Content")
    .items([
      S.documentTypeListItem("media").title("Media"),
      S.divider(),
      S.listItem()
        .title("Taxonomy")
        .child(
          S.list()
            .title("Taxonomy")
            .items([
              S.documentTypeListItem("category").title("Categories"),
              S.documentTypeListItem("tag").title("Tags"),
              S.documentTypeListItem("client").title("Clients"),
              S.documentTypeListItem("collaborator").title("Collaborators"),
            ])
        ),
      S.divider(),
      S.listItem()
        .title("Hidden")
        .child(
          S.documentTypeList("media").title("Hidden").filter('_type == "media" && hidden == true')
        ),
      S.listItem()
        .title("Recently updated")
        .child(
          S.documentTypeList("media")
            .title("Recently updated")
            .defaultOrdering([{ field: "_updatedAt", direction: "desc" }])
        ),
      S.divider(),
      // Fallthrough: any doc type not explicitly listed above.
      ...S.documentTypeListItems().filter(
        (listItem) =>
          !["media", "category", "tag", "client", "collaborator"].includes(listItem.getId() ?? "")
      ),
    ]);

// Side-by-side Form + Preview views on media docs. The preview pane
// iframes the live site route — same SANITY_STUDIO_PREVIEW_URL that
// drives the Presentation tool. For non-media docs, keep the default
// single Form view (no iframe).
export const defaultDocumentNode: DefaultDocumentNodeResolver = (S, { schemaType }) => {
  if (schemaType !== "media") return S.document();
  return S.document().views([S.view.form(), S.view.component(MediaPreview).title("Preview")]);
};
