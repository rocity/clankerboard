import { CheckIcon, ChevronDown } from "lucide-react";
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";
import { Fragment } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export type FilterChoice = { value: string; label: string };
/** Choices under an optional heading, such as "Users" and "Agents". */
export type FilterGroup = { label?: string; choices: FilterChoice[] };

type Props = {
  id: string;
  /** What the filter shows with nothing picked, such as "Any type". It is also the option that clears it. */
  anyLabel: string;
  groups: FilterGroup[];
  value: string[] | undefined;
  onChange: (value: string[] | undefined) => void;
  /** The label of a picked value no choice has, such as an old link's. Defaults to the value. */
  unknownLabel?: (value: string) => string;
};

function Option({
  checked,
  onToggle,
  children,
}: {
  checked: boolean;
  onToggle: () => void;
  children: string;
}) {
  return (
    <DropdownMenuPrimitive.CheckboxItem
      checked={checked}
      onCheckedChange={onToggle}
      // Stay open, so several values can be picked in one go.
      onSelect={(event) => event.preventDefault()}
      className="group flex min-h-11 cursor-default items-center gap-2.5 rounded-sm px-2 py-1.5 text-base outline-hidden select-none focus:bg-accent focus:text-accent-foreground md:min-h-0 md:text-sm"
    >
      <span
        aria-hidden
        className="flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-input group-data-[state=checked]:border-primary group-data-[state=checked]:bg-primary group-data-[state=checked]:text-primary-foreground"
      >
        <DropdownMenuPrimitive.ItemIndicator>
          <CheckIcon className="size-3.5" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      <span className="min-w-0 truncate">{children}</span>
    </DropdownMenuPrimitive.CheckboxItem>
  );
}

/**
 * A board filter that takes several values: a button with the Input look that
 * opens a list of checkboxes. A Ticket matches when it matches any value picked.
 */
export function FilterSelect({ id, anyLabel, groups, value = [], onChange, unknownLabel }: Props) {
  const known = groups.flatMap((g) => g.choices);
  const unknown = value
    .filter((v) => !known.some((c) => c.value === v))
    .map((v) => ({ value: v, label: unknownLabel?.(v) ?? v }));
  const all = unknown.length > 0 ? [...groups, { choices: unknown }] : groups;
  const picked = [...known, ...unknown].filter((c) => value.includes(c.value));
  const summary = picked.length === 0 ? anyLabel : picked.map((c) => c.label).join(", ");

  // Kept in the list's order, so the same picks make the same URL in any click order.
  const toggle = (choice: string) => {
    const next = [...known, ...unknown]
      .map((c) => c.value)
      .filter((v) => (v === choice ? !value.includes(v) : value.includes(v)));
    onChange(next.length > 0 ? next : undefined);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        id={id}
        title={picked.length > 1 ? summary : undefined}
        className={cn(
          "flex h-11 w-full min-w-0 items-center gap-2 rounded-md border border-input bg-transparent pr-3 pl-3 text-left text-base shadow-xs transition-[color,box-shadow] outline-none md:h-9 md:text-sm dark:bg-input/30",
          "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
        )}
      >
        <span className="min-w-0 flex-1 truncate">{summary}</span>
        {picked.length > 1 && (
          <span className="shrink-0 rounded-full bg-primary px-1.5 text-xs text-primary-foreground">
            {picked.length}
          </span>
        )}
        <ChevronDown aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-(--radix-dropdown-menu-trigger-width) min-w-56 max-w-[calc(100vw-2rem)]"
      >
        <Option checked={value.length === 0} onToggle={() => onChange(undefined)}>
          {anyLabel}
        </Option>
        {all.map((group, index) =>
          group.choices.length === 0 ? null : (
            // biome-ignore lint/suspicious/noArrayIndexKey: groups are fixed per filter.
            <Fragment key={index}>
              <DropdownMenuSeparator />
              {group.label && (
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                  {group.label}
                </DropdownMenuLabel>
              )}
              {group.choices.map((choice) => (
                <Option
                  key={choice.value}
                  checked={value.includes(choice.value)}
                  onToggle={() => toggle(choice.value)}
                >
                  {choice.label}
                </Option>
              ))}
            </Fragment>
          ),
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
