import { defineType } from "sanity";

export default defineType({
  name: "collaborator",
  title: "Collaborator",
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
      description: "Optional — personal site or portfolio, opened from the credits tooltip",
      validation: (rule) => rule.uri({ allowRelative: false, scheme: ["http", "https"] }),
    },
  ],
  orderings: [{ title: "Name, A–Z", name: "nameAsc", by: [{ field: "name", direction: "asc" }] }],
  preview: {
    select: { title: "name", subtitle: "url" },
  },
});
