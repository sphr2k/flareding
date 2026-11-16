import { useEffect, useRef, useState, type RefObject } from "react";
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
 * active tag filters appear as native removable Spectrum TagGroup chips beside it.
 * The ComboBox owns keyboard navigation, option selection and mobile suggestion tray.
 */
export function UnifiedSearch({ query, onQueryChange, tags, onTagsChange, searchRef }: Props) {
  const rawFragment = pendingTag(query);
  const [suggestFragment, setSuggestFragment] = useState<string | null>(rawFragment);
  const selectedRef = useRef(false);

  useEffect(() => {
    const timeout = setTimeout(() => setSuggestFragment(rawFragment), 180);
    return () => clearTimeout(timeout);
  }, [rawFragment]);

  const suggestions = useQuery({
    queryKey: ["search-tag-options", suggestFragment],
    queryFn: ({ signal }) => getActiveTagSuggestions(suggestFragment ?? "", signal),
    enabled: rawFragment !== null && suggestFragment !== null,
    staleTime: 60_000,
  });

  const options = (suggestions.data?.results ?? [])
    .filter((item) => !tags.includes(item.name))
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
    onQueryChange(stripPendingTag(query));
    queueMicrotask(() => {
      selectedRef.current = false;
    });
    searchRef.current?.getInputElement()?.focus();
  }

  return (
    <div
      role="search"
      aria-label="Bookmark search and tag filters"
      className={style({
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 8,
        padding: 4,
        width: "full",
        maxWidth: 752,
        borderRadius: "lg",
        backgroundColor: "layer-1",
      })}
      onKeyDown={(event) => {
        if (event.key === "Backspace" && !query && tags.length > 0) {
          event.preventDefault();
          onTagsChange(tags.slice(0, -1));
        }
        // If the listbox did not handle Enter itself (no focused option),
        // commit an exact match or the typed name without requiring Tab.
        if (event.key === "Enter" && rawFragment?.trim()) {
          event.preventDefault();
          const exact = options.find(
            (option) => option.name.toLowerCase() === rawFragment.trim().toLowerCase(),
          );
          selectTag(exact?.name ?? rawFragment.trim());
        }
      }}
    >
      {tags.length > 0 && (
        <TagGroup
          aria-label="Active tag filters"
          size="S"
          items={tags.map((name) => ({ id: name }))}
          onRemove={(keys) => onTagsChange(tags.filter((name) => !keys.has(name)))}
        >
          {(item) => <Tag id={item.id}>{item.id}</Tag>}
        </TagGroup>
      )}
      <ComboBox
        ref={searchRef}
        aria-label="Search bookmarks"
        placeholder="Search bookmarks or type tag:…"
        size="M"
        inputValue={query}
        onInputChange={handleInput}
        selectedKey={null}
        onSelectionChange={(key) => {
          if (key != null) selectTag(String(key));
        }}
        items={rawFragment !== null ? options : []}
        allowsCustomValue
        menuTrigger="input"
        loadingState={rawFragment !== null && suggestions.isFetching ? "loading" : "idle"}
        styles={style({ flexGrow: 1, minWidth: 160 })}
      >
        {(item) => (
          <ComboBoxItem id={item.id} textValue={item.name}>
            {item.name}
          </ComboBoxItem>
        )}
      </ComboBox>
      {rawFragment !== null && suggestions.isError && (
        <StatusLight variant="negative">Tag suggestions unavailable</StatusLight>
      )}
    </div>
  );
}
