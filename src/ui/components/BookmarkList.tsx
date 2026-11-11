import { ListView, ListViewItem } from "@react-spectrum/s2/ListView";
import { ActionMenu, MenuItem } from "@react-spectrum/s2/ActionMenu";
import { style } from "@react-spectrum/s2/style" with { type: "macro" };
import { Image } from "@react-spectrum/s2/Image";
import { Text } from "@react-spectrum/s2/ListView";
import type { BookmarkDTO } from "../../api/bookmark-contract.js";
import { fallbackIconDataUrl, normalizeSiteHost } from "../lib/site-icon.js";

interface Props {
  bookmarks: BookmarkDTO[];
  onToggleArchive: (bookmark: BookmarkDTO) => void;
  isPending?: boolean;
}

/** Native Spectrum ListView instead of a tall parallel set of custom cards. */
export function BookmarkList({ bookmarks, onToggleArchive, isPending = false }: Props) {
  return (
    <ListView
      aria-label="Bookmarks als Liste"
      items={bookmarks}
      dependencies={[isPending]}
      selectionMode="none"
      styles={style({ width: "full" })}
      overflowMode="wrap"
      isQuiet
    >
      {(bookmark) => (
        <ListViewItem
          id={bookmark.id}
          textValue={bookmark.title || bookmark.url}
          href={bookmark.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          <Image
            src={fallbackIconDataUrl(bookmark.url)}
            alt=""
            width={32}
            height={32}
            decoding="async"
          />
          <Text>{bookmark.title || bookmark.url}</Text>
          <Text slot="description">
            {normalizeSiteHost(bookmark.url) ?? "Unbekannte Website"}
            {bookmark.description ? ` · ${bookmark.description.slice(0, 145)}` : ""}
          </Text>
          <ActionMenu
            size="S"
            aria-label={`Aktionen für ${bookmark.title || bookmark.url}`}
            isDisabled={isPending}
            onAction={(key) => {
              if (key === "archive") onToggleArchive(bookmark);
            }}
          >
            <MenuItem id="archive">
              {bookmark.is_archived ? "Wiederherstellen" : "Archivieren"}
            </MenuItem>
          </ActionMenu>
        </ListViewItem>
      )}
    </ListView>
  );
}
