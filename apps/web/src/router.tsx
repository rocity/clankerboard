import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { onUnauthorized } from "@/lib/api";
import { resetActiveCompany } from "@/lib/companies";
import { isPublicPath } from "@/lib/redirect";
import { routeTree } from "./routeTree.gen";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // A 4xx will not change on retry.
      retry: (count, error) => {
        const status = (error as { status?: number }).status;
        return (status === undefined || status >= 500) && count < 2;
      },
    },
  },
});

export const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: "intent",
  scrollRestoration: true,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

// An expired session answers 401 to whatever call comes next. Go to sign-in and
// come back to this page afterwards.
onUnauthorized(() => {
  const { pathname, href } = router.state.location;
  if (isPublicPath(pathname)) return;
  queryClient.clear();
  resetActiveCompany();
  router.navigate({ to: "/sign-in", search: { redirect: href } });
});
