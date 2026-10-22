import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { authClient } from "@/lib/auth-client";
import { resetActiveCompany } from "@/lib/companies";
import { sessionQuery } from "@/lib/queries";

function initials(name: string) {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]);
  return letters.join("").toUpperCase() || "?";
}

export function UserMenu() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const { data: user } = useQuery(sessionQuery);

  async function signOut() {
    await authClient.signOut();
    queryClient.clear();
    resetActiveCompany();
    await router.navigate({ to: "/sign-in", search: { redirect: undefined } });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-11 rounded-full md:size-9"
          aria-label="Account"
        >
          <span className="flex size-8 items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground md:size-7">
            {initials(user?.name ?? "")}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuLabel className="font-normal">
          <div className="truncate font-medium">{user?.name}</div>
          <div className="truncate text-xs text-muted-foreground">{user?.email}</div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="min-h-11 md:min-h-0" onSelect={signOut}>
          <LogOut />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
