import { useRef, useState, type RefObject } from "react";
import { ComboBox, ComboBoxItem } from "@react-spectrum/s2/ComboBox";
import { TagGroup, Tag } from "@react-spectrum/s2/TagGroup";
import { StatusLight } from "@react-spectrum/s2/StatusLight";
import { style } from "@react-spectrum/s2/style" with { type: "macro" };
import { useQuery } from "@tanstack/react-query";
import type { TextFieldRef } from "@react-spectrum/s2/TextField";
import { getActiveTagSuggestions } from "../lib/flareding-v1-client.js";
import { consumeTagSyntax, pendingTag, stripPendingTag } from "../lib/search-filters.js";

interface Props {
  query: string;
  onQueryChange: (value: string) => void;
  tags: string[];
  onTagsChange: (values: string[]) => void;
  searchRef: RefObject<TextFieldRef<HTMLInputElement> | null>;
}

/**
 * A single search surface: normal text and tag: syntax share the ComboBox input;
 * active filters render in a separate native Spectrum TagGroup below the input.
 * The ComboBox owns keyboard navigation, option selection and mobile suggestion tray.
 */
export function UnifiedSearch({ query, onQueryChange, tags, onTagsChange, searchRef }: Props) {
  const rawFragment = pendingTag(query);
  const selectedRef = useRef(false);
  const [selectionEpoch, setSelectionEpoch] = useState(0);

  // Bind the async collection to the actual current query. A separate debounced
  // query caused old suggestions to stay selectable for the new input value.
  // TanStack Query aborts replaced requests through the supplied AbortSignal.
  const suggestions = useQuery({
    queryKey: ["search-tag-options", rawFragment],
    queryFn: ({ signal }) => getActiveTagSuggestions(rawFragment ?? "", signal),
    enabled: rawFragment !== null,
    staleTime: 60_000,
  });

  const liveFragment = rawFragment?.trim().toLocaleLowerCase() ?? "";
  const options = (suggestions.data?.results ?? [])
    .filter((item) => !tags.includes(item.name))
    .filter((item) => item.name.toLocaleLowerCase().includes(liveFragment))
    .map(({ name }) => ({ id: name, name }));

  function addTags(next: string[]) {
    onTagsChange([...new Set([...tags, ...next])].slice(0, 12));
  }

  function handleInput(value: string) {
    if (selectedRef.current) return;
    const parsed = consumeTagSyntax(value);
    onQueryChange(parsed.query);
    if (parsed.tags.length) addTags(parsed.tags);
  }

  function selectTag(name: string) {
    selectedRef.current = true;
    addTags([name]);
    setSelectionEpoch((epoch) => epoch + 1);
    onQueryChange(stripPendingTag(query));
    // Remounting the native field when leaving tag mode closes its listbox.
    // Restore focus after the new instance has mounted.
    requestAnimationFrame(() => searchRef.current?.getInputElement()?.focus());
    queueMicrotask(() => {
      selectedRef.current = false;
    });
  }

  return (
    <div
      role="search"
      aria-label="Bookmark search and tag filters"
      className={style({
        display: "flex",
        flexDirection: "column",
        gap: 8,
        width: "full",
        maxWidth: 752,
        minWidth: 0,
      })}
      onKeyDown={(event) => {
        // Delegate Enter/ArrowDown/Escape entirely to native Spectrum ComboBox.
        if (event.target !== searchRef.current?.getInputElement()) return;
        if (event.key === "Backspace" && !query && tags.length > 0) {
          event.preventDefault();
          onTagsChange(tags.slice(0, -1));
        }
      }}
    >
      <ComboBox
        key={selectionEpoch}
        ref={searchRef}
        aria-label="Search bookmarks"
        placeholder="Search bookmarks or type tag:…"
        size="M"
        inputValue={query}
        onInputChange={handleInput}
        onSelectionChange={(key) => {
          if (key != null) selectTag(String(key));
        }}
        items={rawFragment !== null ? options : []}
        allowsCustomValue
        menuTrigger={rawFragment === null ? "manual" : "input"}
        loadingState={rawFragment !== null && suggestions.isFetching ? "loading" : "idle"}
        styles={style({ width: "full" })}
      >
        {(item) => (
          <ComboBoxItem id={item.id} textValue={item.name}>
            {item.name}
          </ComboBoxItem>
        )}
      </ComboBox>
      {tags.length > 0 && (
        <TagGroup
          aria-label="Active tag filters"
          size="M"
          items={tags.map((name) => ({ id: name }))}
          onRemove={(keys) => onTagsChange(tags.filter((name) => !keys.has(name)))}
        >
          {(item) => <Tag id={item.id}>{item.id}</Tag>}
        </TagGroup>
      )}
      {rawFragment !== null && suggestions.isError && (
        <StatusLight variant="negative">Tag suggestions unavailable</StatusLight>
      )}
    </div>
  );
}
