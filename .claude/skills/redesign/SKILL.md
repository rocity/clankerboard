---
name: redesign
description: >
  Use whenever the user says "redesign" a section, component, or page of the
  Clankerboard web app (`apps/web`): the board, a Ticket card, Ticket detail,
  Company/Team settings, the Invite flow, and so on. A redesign request is a
  request to reconsider layout, grouping, hierarchy, and sizing. It is not
  permission to swap Tailwind color classes and call it done. Also invoke
  proactively if you notice yourself answering a "redesign" ask by editing
  only `bg-*`/`text-*`/`border-*` classes or shadcn `variant` props while the
  JSX structure stays untouched: stop and re-read this first. SKIP when the
  user explicitly asks for a color/theme-token change only, or for a narrow
  layout bug fix (overflow, z-index, a broken breakpoint). Those touch styling
  but are not redesigns.
---

# Redesign means recompose, not recolor

**A redesign changes what's grouped with what, what's emphasized over what,
and what size things are. If your diff is only color classes or `variant`
props, you haven't redesigned anything. You've reskinned it, and the user
will notice.**

This skill exists because a color-only "redesign" was rejected twice in one
session on an earlier project:

> "did you even do anything? it looks the same"
> "the layout is the same, you only changed colors"

## Ask these before touching a single className

- What's the *primary* action or information here, and do its size, weight,
  and position say so?
- What's secondary or utility? Should it be visually grouped or subordinated,
  not just recolored to look "less important"?
- Does the spatial arrangement (row vs. stack, grouped vs. spread, aligned
  vs. split) communicate the same hierarchy the colors do?
- Does it still work when an Agent changes it live? Cards move between
  Status columns over SSE while the user is looking. A layout that only reads
  well when static is not done.

## Worked example: the Ticket card

A Ticket card carries a lot of metadata: Ticket Key (`CB-42`), Ticket Type,
priority, Parent Epic, title, and Assignee (User or Agent).

**Recolor (wrong):** keep every element as a same-size badge in one flat
row, and only change badge `variant`s so each one gets its own color. It
still reads as "six identical pills", and nothing says what matters.

**Recompose (right):** decide the hierarchy first.
- The **title** is the primary content. It gets the most weight and space,
  sitting on its own line.
- **Ticket Key + Ticket Type** form one quiet identifier group at the top
  (monospace key, small type icon). Someone scanning the board uses it to
  find a ticket, not to read it.
- **Priority** appears only when it's high or urgent. A `low` badge on every
  card is noise.
- The **Assignee** goes in its own corner, and Agents are visually distinct
  from Users (e.g. a `Bot` icon from lucide next to the Agent's name). That
  distinction is the reason Clankerboard exists, so it must survive any
  redesign.

These are decisions about grouping and emphasis, not about colors.

## Why color-only edits often don't even register

Beyond being the wrong lever, it may be invisible. shadcn/ui's default
neutral theme defines several "different" surface tokens with the **same
value**: `--secondary`, `--muted`, and `--accent` are identical in both light
and dark. In dark mode, `--card` sits only a few lightness points above
`--background`, and `--border` is white at 10% alpha.

So `bg-muted` on something that's already `bg-accent` changes nothing, and
`bg-card` on `bg-background` in dark mode is barely visible at badge size.
Before leaning on token contrast, check the actual values in the theme CSS
in `apps/web` (they may have been customized). Then verify visibility (see
below). Don't assume a different token name implies different contrast.

## Two proportion bugs to check on every redesign

**1. Touch targets too small on mobile.** shadcn `Button` sizes: `default` is
`h-9` (36px), `sm` is `h-8` (32px), `lg` is `h-10` (40px), and `icon` is
`size-9` (36px). All are below the ~44px Apple HIG / Material minimum. For
any standalone icon-only control a thumb has to hit (card menus, the Company
switcher, drag handles on mobile), use `size-11` or the largest size the
project defines. Use smaller sizes only inside dense toolbars, next to a
bigger primary control.

**2. Mismatched heights between siblings in one row.** If you group two
controls together and give them different `size` props, each looks fine
alone but the row looks broken. Example: a `Button size="sm"` next to an
icon button at `size-11`. When controls share a row, match their sizes, or
check the rendered heights in a screenshot.

## Copy that changes during a redesign

If the redesign touches text the end user reads (labels, empty states,
buttons, toasts), follow `.claude/rules/user-facing-copy.md`: no em dashes,
no emojis, no overexplaining. Use an icon component for the Agent marker,
not a 🤖 emoji.

## Verify in-browser, don't assert

"This should look different now" is not verification. Take a screenshot.
- Use the `run` skill to start the dev server.
- Check a mobile viewport (375px) and a desktop one (1280px+).
- Check both light and dark themes. Switch without clicking through: the theme
  is the `dark` class on `<html>`, chosen by the localStorage key
  `clankerboard-theme` (`"light"`, `"dark"`, or absent for the system setting).
  In Playwright, `page.addInitScript(() => localStorage.setItem("clankerboard-theme", "dark"))`
  before `goto`, or `page.emulateMedia({ colorScheme: "dark" })` to follow the
  system. The key lives in `apps/web/src/lib/theme.ts` and the inline script in
  `apps/web/index.html`.

For board views specifically:
- **Mobile:** columns overflow horizontally. Check that the column you're
  redesigning is reachable and that its first card isn't clipped.
- **Real data:** seed enough Tickets that columns scroll. Include a long
  title, a long Agent name, and an archived Parent.
- **Live updates:** watch a card move while the page is open. Either drag
  it, or trigger `move_ticket`/`claim_ticket` through the MCP endpoint.

Don't report a redesign as done until you have looked at a screenshot, in
both themes, at the breakpoint the user is complaining about.
