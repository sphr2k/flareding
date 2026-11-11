import { SearchField } from "@react-spectrum/s2/SearchField";
import type { TextFieldRef } from "@react-spectrum/s2/TextField";
import { style } from "@react-spectrum/s2/style" with { type: "macro" };
import type { RefObject } from "react";
import { Button } from "@react-spectrum/s2/Button";

interface Props {
  search: string;
  onSearchChange: (value: string) => void;
  searchRef: RefObject<TextFieldRef<HTMLInputElement> | null>;
  onAddOpenChange: (open: boolean) => void;
  isNarrow: boolean;
  onLogout: () => void;
}

export function AppHeader({
  search,
  onSearchChange,
  searchRef,
  onAddOpenChange,
  onLogout,
  isNarrow,
}: Props) {
  return (
    <header
      className={style({
        gridArea: "toolbar",
        display: "flex",
        alignItems: "center",
        gap: 20,
        padding: 16,
        paddingStart: 20,
        boxSizing: "border-box",
        minWidth: 0,
        flexWrap: { default: "wrap", "@media (min-width: 768px)": "nowrap" },
      })}
    >
      <strong
        className={style({
          font: "heading-sm",
          flexShrink: 0,
          marginEnd: { default: "auto", "@media (min-width: 768px)": 0 },
        })}
      >
        flareding
      </strong>
      <div
        className={style({
          flexGrow: 1,
          minWidth: 0,
          display: "flex",
          justifyContent: "center",
          order: { default: 1, "@media (min-width: 768px)": 0 },
          flexBasis: { default: "full", "@media (min-width: 768px)": "auto" },
        })}
      >
        <SearchField
          aria-label="Search bookmarks"
          placeholder="Title, URL or description…"
          value={search}
          onChange={onSearchChange}
          ref={searchRef}
          styles={style({ width: "full", maxWidth: 768 })}
        />
      </div>
      {isNarrow && (
        <Button variant="accent" onPress={() => onAddOpenChange(true)}>
          + Add
        </Button>
      )}
      <Button variant="secondary" onPress={onLogout}>
        Logout
      </Button>
    </header>
  );
}
