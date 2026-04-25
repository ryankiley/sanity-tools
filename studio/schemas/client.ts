import { defineType } from "sanity";

export default defineType({
  name: "client",
  title: "Client",
  type: "document",
  fields: [
    {
      name: "name",
      title: "Name",
      type: "string",
      validation: (rule) => rule.required().max(80),
    },
    {
      name: "slug",
      title: "Slug",
      type: "slug",
      options: { source: "name", maxLength: 96 },
      validation: (rule) => rule.required(),
    },
    {
      name: "url",
      title: "Website",
      type: "url",
      description: "Website URL (optional — stored for future use on the site)",
      validation: (rule) => rule.uri({ allowRelative: false, scheme: ["http", "https"] }),
    },
  ],
  orderings: [{ title: "Name, A–Z", name: "nameAsc", by: [{ field: "name", direction: "asc" }] }],
  preview: {
    select: { title: "name", subtitle: "url" },
  },
});
