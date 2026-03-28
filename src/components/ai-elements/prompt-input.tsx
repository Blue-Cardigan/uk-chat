import { useState } from "react";
import { Button, Textarea } from "@/components/ui/primitives";

export function PromptInput({
  onSubmit,
  isLoading,
  placeholder,
}: {
  onSubmit: (text: string) => void;
  isLoading?: boolean;
  placeholder?: string;
}) {
  const [value, setValue] = useState("");

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const trimmed = value.trim();
        if (!trimmed) return;
        onSubmit(trimmed);
        setValue("");
      }}
    >
      <Textarea
        placeholder={placeholder ?? "Ask a UK data question..."}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        className="min-h-20"
      />
      <div className="flex justify-end">
        <Button type="submit" disabled={isLoading}>
          {isLoading ? "Streaming..." : "Send"}
        </Button>
      </div>
    </form>
  );
}
