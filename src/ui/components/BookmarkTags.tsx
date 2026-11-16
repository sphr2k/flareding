import { useEffect, useRef, useState } from "react";
import { ActionButton } from "@react-spectrum/s2/ActionButton";
import { Popover } from "@react-spectrum/s2/Popover";
import { TagGroup, Tag } from "@react-spectrum/s2/TagGroup";
import { style } from "@react-spectrum/s2/style" with { type: "macro" };

interface Props {
  tags: string[];
}

/**
 * The abbreviated footer is a proper button: hover and focus disclose the complete
 * collection, while press also opens it for touch users.
 */
export function BookmarkTags({ tags }: Props) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLSpanElement>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  function cancelTimers() {
    clearTimeout(openTimer.current);
    clearTimeout(closeTimer.current);
  }

  useEffect(() => cancelTimers, []);

  function startHover() {
    cancelTimers();
    openTimer.current = setTimeout(() => setOpen(true), 200);
  }

  function endHover() {
    clearTimeout(openTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), 250);
  }

  const summary = tags.slice(0, 3).join(" · ") + (tags.length > 3 ? ` +${tags.length - 3}` : "");

  return (
    <>
      <span
        ref={anchor}
        onPointerEnter={(event) => {
          if (event.pointerType === "mouse") startHover();
        }}
        onPointerLeave={(event) => {
          if (event.pointerType === "mouse") endHover();
        }}
        onFocus={() => {
          cancelTimers();
          setOpen(true);
        }}
      >
        <ActionButton
          size="XS"
          isQuiet
          aria-label={`Show all ${tags.length} bookmark tags`}
          aria-expanded={open}
          onPress={() => {
            cancelTimers();
            setOpen(true);
          }}
          styles={style({ maxWidth: "full" })}
        >
          {summary}
        </ActionButton>
      </span>
      <Popover triggerRef={anchor} isOpen={open} onOpenChange={setOpen} placement="top" size="S">
        <div
          onPointerEnter={(event) => {
            if (event.pointerType === "mouse") cancelTimers();
          }}
          onPointerLeave={(event) => {
            if (event.pointerType === "mouse") endHover();
          }}
          className={style({
            maxWidth: 360,
            maxHeight: 300,
            overflow: "auto",
            padding: 12,
          })}
        >
          <TagGroup
            label={`All ${tags.length} tags`}
            size="S"
            items={tags.map((name) => ({ id: name }))}
          >
            {(item) => <Tag id={item.id}>{item.id}</Tag>}
          </TagGroup>
        </div>
      </Popover>
    </>
  );
}
