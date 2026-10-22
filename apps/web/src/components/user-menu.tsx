import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams, useRouter } from "@tanstack/react-router";
import { Bot, LogOut } from "lucide-react";
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
import { initials } from "@/lib/initials";
import { sessionQuery } from "@/lib/queries";

export function UserMenu() {
  const queryClient = useQueryClient();
  const router = useRouter();
  // Set only on Company pages, which are the ones with Company links to show.
  const companySlug = useParams({ strict: false }).companySlug;
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
          aria-label="User menu"
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
        {companySlug && (
          <DropdownMenuItem asChild className="min-h-11 md:min-h-0">
            <Link to="/$companySlug/agents" params={{ companySlug }}>
              <Bot />
              Agents
            </Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem className="min-h-11 md:min-h-0" onSelect={signOut}>
          <LogOut />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
