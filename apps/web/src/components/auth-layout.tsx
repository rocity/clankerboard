import type { ReactNode } from "react";
import { Brand } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";
import { UserMenu } from "@/components/user-menu";

type Props = {
  children: ReactNode;
  /** Shows the User menu, for pages a signed-in User can be stuck on. */
  signedIn?: boolean;
};

/** The frame for pages shown before a Company is chosen: sign-in, sign-up, Invites, first Company. */
export function AuthLayout({ children, signedIn }: Props) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-between px-4 py-2 md:px-6">
        <Brand />
        <div className="flex items-center">
          <ThemeToggle />
          {signedIn && <UserMenu />}
        </div>
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pt-6 pb-12 md:items-center md:pt-0">
        <div className="w-full max-w-sm">{children}</div>
      </main>
    </div>
  );
}
