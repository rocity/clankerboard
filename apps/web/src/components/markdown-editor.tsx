import { Markdown } from "@/components/markdown";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

type Props = {
  /** Names the text area for screen readers. */
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
};

/** A Markdown text area with a Write tab and a Preview tab that renders it as readers will see it. */
export function MarkdownEditor({ label, value, onChange, placeholder, disabled }: Props) {
  return (
    <Tabs defaultValue="write">
      <TabsList>
        <TabsTrigger value="write">Write</TabsTrigger>
        <TabsTrigger value="preview">Preview</TabsTrigger>
      </TabsList>
      <TabsContent value="write">
        <Textarea
          aria-label={label}
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          className="min-h-32"
        />
      </TabsContent>
      <TabsContent value="preview">
        <div
          data-testid="markdown-preview"
          className="min-h-32 rounded-md border border-input px-3 py-2"
        >
          {value.trim() ? (
            <Markdown source={value} />
          ) : (
            <p className="text-sm text-muted-foreground">Nothing to preview.</p>
          )}
        </div>
      </TabsContent>
    </Tabs>
  );
}
