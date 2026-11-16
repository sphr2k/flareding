import { ActionButton } from "@react-spectrum/s2/ActionButton";
import { Tooltip, TooltipTrigger } from "@react-spectrum/s2/Tooltip";
import { TagGroup, Tag } from "@react-spectrum/s2/TagGroup";
import { style } from "@react-spectrum/s2/style" with { type: "macro" };

interface Props {
  tags: string[];
}

/**
 * Native Spectrum hover/focus tooltip, not a manually-controlled Popover.
 * The preview is read-only: the tooltip never steals focus or intercepts the
 * pointer, eliminating the previous hover/leave feedback loop.
 */
export function BookmarkTags({ tags }: Props) {
  const summary = tags.slice(0, 3).join(" · ") + (tags.length > 3 ? ` +${tags.length - 3}` : "");
  return (
    <span className={style({ marginStart: -8 })}>
      <TooltipTrigger placement="top">
        <ActionButton
          aria-label={`Show all ${tags.length} bookmark tags`}
          size="M"
          isQuiet
          styles={style({ maxWidth: "full" })}
        >
          {summary}
        </ActionButton>
        <Tooltip>
          <div className={style({ maxWidth: 400, maxHeight: 320, overflow: "auto", padding: 8 })}>
            <TagGroup
              label={`All ${tags.length} tags`}
              size="M"
              items={tags.map((name) => ({ id: name }))}
            >
              {(item) => <Tag id={item.id}>{item.id}</Tag>}
            </TagGroup>
          </div>
        </Tooltip>
      </TooltipTrigger>
    </span>
  );
}
