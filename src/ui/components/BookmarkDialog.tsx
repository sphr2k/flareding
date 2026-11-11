import { DialogContainer, Dialog, Heading, Content, ButtonGroup } from "@react-spectrum/s2/Dialog";
import { AlertDialog } from "@react-spectrum/s2/AlertDialog";
import { Button } from "@react-spectrum/s2/Button";
import { Form } from "@react-spectrum/s2/Form";
import { TextField } from "@react-spectrum/s2/TextField";
import { TextArea } from "@react-spectrum/s2/TextArea";
import { ComboBox, ComboBoxItem } from "@react-spectrum/s2/ComboBox";
import { TagGroup, Tag } from "@react-spectrum/s2/TagGroup";
import { InlineAlert } from "@react-spectrum/s2/InlineAlert";
import { style } from "@react-spectrum/s2/style" with { type: "macro" };
import { useEffect, useId, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import type { BookmarkDTO } from "../../api/bookmark-contract.js";

export interface BookmarkInput {
  url: string;
  title: string;
  description: string;
  notes: string;
  tag_names: string[];
}
interface Props {
  bookmark?: BookmarkDTO;
  onClose: () => void;
  onSave: (input: BookmarkInput) => Promise<void>;
}

export function BookmarkDialog({ bookmark, onClose, onSave }: Props) {
  const formId = useId();
  const [isNarrow, setNarrow] = useState(() => window.matchMedia("(max-width: 640px)").matches);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 640px)");
    const sync = () => setNarrow(media.matches);
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  const initial: BookmarkInput = {
    url: bookmark?.url ?? "",
    title: bookmark?.title ?? "",
    description: bookmark?.description ?? "",
    notes: bookmark?.notes ?? "",
    tag_names: bookmark?.tag_names ?? [],
  };
  const [values, setValues] = useState(initial);
  const [tagInput, setTagInput] = useState("");
  const [tagSearch, setTagSearch] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setTagSearch(tagInput.trim()), 200);
    return () => clearTimeout(timer);
  }, [tagInput]);
  const tags = useQuery({
    queryKey: ["tags", tagSearch],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({ q: tagSearch, limit: "30" });
      const response = await fetch(`/api/tags/?${params}`, { signal, credentials: "same-origin" });
      if (!response.ok) throw new Error("Could not load tag suggestions.");
      return (await response.json()) as { results: { name: string }[] };
    },
    staleTime: 60_000,
  });
  const canonical = (input: BookmarkInput) =>
    JSON.stringify({ ...input, tag_names: [...input.tag_names].sort() });
  const dirty = canonical(values) !== canonical(initial) || !!tagInput.trim();
  const candidates = (tags.data?.results ?? []).filter(
    (item) => !values.tag_names.includes(item.name),
  );
  const typedTag = tagInput.trim();
  const options = candidates.map((item) => ({ name: item.name, label: item.name }));
  if (
    typedTag &&
    !values.tag_names.includes(typedTag) &&
    !options.some((item) => item.name === typedTag)
  )
    options.unshift({ name: typedTag, label: `Add “${typedTag}”` });
  function requestClose() {
    if (busy) return;
    if (dirty) setConfirmDiscard(true);
    else onClose();
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !dirty) return;
    setError("");
    setBusy(true);
    try {
      const tag_names = [...new Set([...values.tag_names, ...(typedTag ? [typedTag] : [])])];
      await onSave({ ...values, tag_names });
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save bookmark.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <DialogContainer onDismiss={requestClose}>
        <Dialog size="M" isKeyboardDismissDisabled={busy}>
          <Heading slot="title">{bookmark ? "Edit bookmark" : "Add bookmark"}</Heading>
          <Content>
            <Form
              id={formId}
              size="M"
              labelPosition={isNarrow ? "top" : "side"}
              isDisabled={busy}
              onSubmit={submit}
            >
              <TextField
                label="Title"
                value={values.title}
                autoFocus={!!bookmark}
                onChange={(title) => setValues((v) => ({ ...v, title }))}
              />
              <TextField
                label="URL"
                type="url"
                isRequired
                value={values.url}
                autoFocus={!bookmark}
                onChange={(url) => setValues((v) => ({ ...v, url }))}
              />
              <div className={style({ display: "contents" })}>
                <TagGroup
                  label="Tags"
                  size="M"
                  items={values.tag_names.map((name) => ({ id: name }))}
                  onRemove={(keys) =>
                    setValues((v) => ({
                      ...v,
                      tag_names: v.tag_names.filter((name) => !keys.has(name)),
                    }))
                  }
                >
                  {(item) => <Tag id={item.id}>{item.id}</Tag>}
                </TagGroup>
                <ComboBox
                  label="Add tag"
                  placeholder="Search or add a tag…"
                  size="M"
                  items={options}
                  inputValue={tagInput}
                  onInputChange={setTagInput}
                  selectedKey={null}
                  allowsCustomValue
                  menuTrigger="input"
                  direction="bottom"
                  shouldFlip={false}
                  loadingState={tags.isFetching ? "loading" : "idle"}
                  onSelectionChange={(key) => {
                    if (key !== null) {
                      setValues((v) => ({
                        ...v,
                        tag_names: [...new Set([...v.tag_names, String(key)])],
                      }));
                      setTagInput("");
                    }
                  }}
                >
                  {(item) => (
                    <ComboBoxItem id={item.name} textValue={item.name}>
                      {item.label}
                    </ComboBoxItem>
                  )}
                </ComboBox>
                {tags.error && (
                  <InlineAlert variant="negative">
                    <Heading>Tag search failed</Heading>
                    <Content>{tags.error.message} You can still enter new tags.</Content>
                  </InlineAlert>
                )}
              </div>
              <TextArea
                label="Description"
                value={values.description}
                onChange={(description) => setValues((v) => ({ ...v, description }))}
              />
              <TextArea
                label="Notes"
                placeholder="Add notes…"
                value={values.notes}
                onChange={(notes) => setValues((v) => ({ ...v, notes }))}
              />
              {error && (
                <InlineAlert variant="negative">
                  <Heading>Could not save bookmark</Heading>
                  <Content>{error}</Content>
                </InlineAlert>
              )}
            </Form>
          </Content>
          <ButtonGroup>
            <Button variant="secondary" onPress={requestClose} isDisabled={busy}>
              Cancel
            </Button>
            <Button
              variant="accent"
              type="submit"
              form={formId}
              isPending={busy}
              isDisabled={!values.url.trim() || !dirty}
            >
              Save
            </Button>
          </ButtonGroup>
        </Dialog>
      </DialogContainer>
      <DialogContainer onDismiss={() => setConfirmDiscard(false)}>
        {confirmDiscard && (
          <AlertDialog
            title="Discard changes?"
            cancelLabel="Keep editing"
            primaryActionLabel="Discard"
            variant="destructive"
            autoFocusButton="cancel"
            onCancel={() => setConfirmDiscard(false)}
            onPrimaryAction={onClose}
          >
            Your unsaved changes will be lost.
          </AlertDialog>
        )}
      </DialogContainer>
    </>
  );
}
