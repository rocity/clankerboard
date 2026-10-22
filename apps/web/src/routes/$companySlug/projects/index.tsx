import { createFileRoute, redirect } from "@tanstack/react-router";

// There is no page for `/<company>/projects` itself: the Projects list is the Company's home.
export const Route = createFileRoute("/$companySlug/projects/")({
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/$companySlug", params, replace: true });
  },
});
