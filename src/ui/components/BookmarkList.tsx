import { ListView, ListViewItem } from "@react-spectrum/s2/ListView";
import { ActionMenu, MenuItem } from "@react-spectrum/s2/ActionMenu";
import { style } from "@react-spectrum/s2/style" with { type: "macro" };
import { Image } from "@react-spectrum/s2/Image";
import { Text } from "@react-spectrum/s2/ListView";
import type { BookmarkDTO } from "../../api/bookmark-contract.js";
import { fallbackIconDataUrl, normalizeSiteHost, trustedSiteIconSrc } from "../lib/site-icon.js";

interface Props {
  bookmarks: BookmarkDTO[];
  onEdit: (bookmark: BookmarkDTO) => void;
  onToggleArchive: (bookmark: BookmarkDTO) => void;
  isPending?: boolean;
}

/** Native Spectrum ListView instead of a tall parallel set of custom cards. */
export function BookmarkList({ bookmarks, onEdit, onToggleArchive, isPending = false }: Props) {
  return (
    <ListView
      aria-label="Bookmark list"
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
            src={
              trustedSiteIconSrc(bookmark.favicon_url, window.location.origin) ??
              fallbackIconDataUrl(bookmark.url)
            }
            alt=""
            width={32}
            height={32}
            decoding="async"
            loading="lazy"
            renderError={() => (
              <img src={fallbackIconDataUrl(bookmark.url)} alt="" width={32} height={32} />
            )}
          />
          <Text>{bookmark.title || bookmark.url}</Text>
          <Text slot="description">
            {normalizeSiteHost(bookmark.url) ?? "Unknown website"}
            {bookmark.description ? ` · ${bookmark.description.slice(0, 145)}` : ""}
          </Text>
          <ActionMenu
            size="S"
            aria-label={`Actions for ${bookmark.title || bookmark.url}`}
            isDisabled={isPending}
            onAction={(key) => {
              if (key === "edit") onEdit(bookmark);
              if (key === "archive") onToggleArchive(bookmark);
            }}
          >
            <MenuItem id="edit">Edit</MenuItem>
            <MenuItem id="archive">{bookmark.is_archived ? "Unarchive" : "Archive"}</MenuItem>
          </ActionMenu>
        </ListViewItem>
      )}
    </ListView>
  );
}
