import { defaultLabelColor, normalizeLabelName } from "@agentkanban/shared";
import { useQuery } from "@tanstack/react-query";
import { type ChangeEvent, type KeyboardEvent, useState } from "react";
import { LabelChip } from "@/components/label-chip";
import { Label } from "@/components/ui/label";
import { labelsQuery } from "@/lib/labels";
import { cn } from "@/lib/utils";

type Props = {
  id: string;
  /** Label names, in the order to show them. */
  value: string[];
  disabled?: boolean;
  /** The heading's look. Ticket detail's small grey one by default. */
  labelClassName?: string;
  /**
   * Saves the whole new set. May resolve once the server has answered, whether
   * or not it accepted; until then the field shows the set being saved.
   */
  onChange: (names: string[]) => unknown;
};

/**
 * A Ticket's Labels as chips, each with a remove control, and an input that
 * suggests the Company's other Labels and adds a name on Enter or when a
 * suggestion is picked. A name no Label has yet is shown in the color it will
 * get, since the server picks that color from the name the same way.
 */
export function LabelsField({
  id,
  value,
  disabled,
  labelClassName = "text-xs text-muted-foreground",
  onChange,
}: Props) {
  const { data: labels = [] } = useQuery(labelsQuery);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState<string[] | null>(null);
  const shown = saving ?? value;
  const held = new Set(shown.map(normalizeLabelName));
  const suggestions = labels.filter((label) => !held.has(normalizeLabelName(label.name)));
  const colorOf = (name: string) =>
    labels.find((label) => normalizeLabelName(label.name) === normalizeLabelName(name))?.color ??
    defaultLabelColor(name);

  async function save(next: string[]) {
    setSaving(next);
    try {
      await onChange(next);
    } finally {
      setSaving(null);
    }
  }

  function add(typed: string) {
    const name = typed.trim();
    setText("");
    if (!name || held.has(normalizeLabelName(name))) return;
    // An existing Label is added as it is spelled, so the chip reads the same everywhere.
    const known = labels.find(
      (label) => normalizeLabelName(label.name) === normalizeLabelName(name),
    );
    void save([...shown, known?.name ?? name]);
  }

  function onInput(event: ChangeEvent<HTMLInputElement>) {
    const typed = event.target.value;
    // Picking a suggestion replaces the text without a keystroke, so it is added at once.
    const picked =
      !(event.nativeEvent instanceof InputEvent) ||
      event.nativeEvent.inputType === "insertReplacementText";
    if (picked && suggestions.some((label) => label.name === typed)) add(typed);
    else setText(typed);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      add(text);
    }
    if (event.key === "Escape" && text) {
      event.stopPropagation();
      setText("");
    }
  }

  return (
    <div className="grid min-w-0 gap-1.5">
      <Label htmlFor={id} className={labelClassName}>
        Labels
      </Label>
      <div
        className={cn(
          "flex min-h-11 min-w-0 flex-wrap items-center gap-1.5 rounded-md border border-input bg-transparent px-2 py-1.5 shadow-xs md:min-h-9",
          "focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 dark:bg-input/30",
        )}
      >
        {shown.length > 0 && (
          <ul aria-label="Labels on this ticket" className="contents">
            {shown.map((name) => (
              <li key={normalizeLabelName(name)} className="flex min-w-0">
                <LabelChip
                  label={{ name, color: colorOf(name) }}
                  disabled={disabled || saving !== null}
                  onRemove={() =>
                    void save(
                      shown.filter(
                        (other) => normalizeLabelName(other) !== normalizeLabelName(name),
                      ),
                    )
                  }
                />
              </li>
            ))}
          </ul>
        )}
        <input
          id={id}
          type="text"
          list={`${id}-suggestions`}
          value={text}
          disabled={disabled}
          maxLength={30}
          autoComplete="off"
          enterKeyHint="done"
          placeholder={shown.length === 0 ? "Add a label" : "Add another"}
          onChange={onInput}
          onKeyDown={onKeyDown}
          className="h-8 min-w-24 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed md:h-6 md:text-sm"
        />
        <datalist id={`${id}-suggestions`}>
          {suggestions.map((label) => (
            <option key={label.id} value={label.name} />
          ))}
        </datalist>
      </div>
    </div>
  );
}
