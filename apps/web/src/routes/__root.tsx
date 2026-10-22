import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, Link, Outlet } from "@tanstack/react-router";
import { AuthLayout } from "@/components/auth-layout";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: RootLayout,
  notFoundComponent: NotFound,
});

function RootLayout() {
  return (
    <>
      <Outlet />
      <Toaster />
    </>
  );
}

function NotFound() {
  return (
    <AuthLayout>
      <div className="grid gap-4 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
        <Button asChild className="h-11">
          <Link to="/">Go home</Link>
        </Button>
      </div>
    </AuthLayout>
  );
}
