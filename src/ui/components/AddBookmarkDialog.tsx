import { DialogTrigger, Dialog, Heading, Content } from "@react-spectrum/s2/Dialog";
import { Button } from "@react-spectrum/s2/Button";
import { Form } from "@react-spectrum/s2/Form";
import { TextField } from "@react-spectrum/s2/TextField";
import { InlineAlert } from "@react-spectrum/s2/InlineAlert";
import { style } from "@react-spectrum/s2/style" with { type: "macro" };
import { useState, type FormEvent } from "react";

interface Props {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (input: { url: string; title: string; tag_names: string[] }) => Promise<void>;
}

export function AddBookmarkDialog({ isOpen, onOpenChange, onCreate }: Props) {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [tags, setTags] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>, close: () => void) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      await onCreate({
        url,
        title,
        tag_names: [
          ...new Set(
            tags
              .split(",")
              .map((item) => item.trim())
              .filter(Boolean),
          ),
        ],
      });
      setUrl("");
      setTitle("");
      setTags("");
      close();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Speichern fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <DialogTrigger isOpen={isOpen} onOpenChange={onOpenChange}>
      <Button variant="accent" size="M" onPress={() => onOpenChange(true)}>
        + Hinzufügen
      </Button>
      <Dialog size="M" isDismissible>
        {({ close }) => (
          <>
            <Heading slot="title">Bookmark hinzufügen</Heading>
            <Content>
              <Form onSubmit={(event) => void submit(event, close)}>
                <TextField
                  label="URL"
                  value={url}
                  onChange={setUrl}
                  type="url"
                  isRequired
                  autoFocus
                />
                <TextField label="Titel" value={title} onChange={setTitle} />
                <TextField
                  label="Tags"
                  description="Mehrere Tags mit Komma trennen"
                  value={tags}
                  onChange={setTags}
                />
                {error && (
                  <InlineAlert variant="negative">
                    <Heading>Speichern fehlgeschlagen</Heading>
                    <Content>{error}</Content>
                  </InlineAlert>
                )}
                <div
                  className={style({
                    display: "flex",
                    justifyContent: "end",
                    gap: 12,
                    flexWrap: "wrap",
                  })}
                >
                  <Button variant="secondary" type="button" onPress={close}>
                    Abbrechen
                  </Button>
                  <Button variant="accent" type="submit" isPending={busy} isDisabled={!url.trim()}>
                    Speichern
                  </Button>
                </div>
              </Form>
            </Content>
          </>
        )}
      </Dialog>
    </DialogTrigger>
  );
}
