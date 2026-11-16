import { useRef, useState } from "react";
import { DialogContainer, Dialog, Heading, Content, ButtonGroup } from "@react-spectrum/s2/Dialog";
import { Button } from "@react-spectrum/s2/Button";
import { ActionButton } from "@react-spectrum/s2/ActionButton";
import { TextField, type TextFieldRef } from "@react-spectrum/s2/TextField";
import { Tooltip, TooltipTrigger } from "@react-spectrum/s2/Tooltip";
import { style } from "@react-spectrum/s2/style" with { type: "macro" };
import Visibility from "@react-spectrum/s2/icons/Visibility";
import Copy from "@react-spectrum/s2/icons/Copy";

interface Props {
  onClose: () => void;
}

const MASKED_TOKEN = "000000000000000000000000";

/**
 * Keep a fixed-size, read-only field and icon action throughout loading/reveal/copy.
 * Never fetch the credential before explicit user interaction or persist it on disk.
 */
export function SettingsDialog({ onClose }: Props) {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState(false);
  const fieldRef = useRef<TextFieldRef<HTMLInputElement>>(null);
  const pending = useRef(false);

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setError(false);
      setStatus("Token copied to clipboard.");
    } catch {
      // On the first reveal React has not necessarily rendered the new value yet.
      requestAnimationFrame(() => fieldRef.current?.select());
      setError(true);
      setStatus("Clipboard access denied. Select the token and copy it manually.");
    }
  }

  async function revealAndCopy() {
    if (pending.current) return;
    if (token) {
      await copy(token);
      return;
    }

    pending.current = true;
    setBusy(true);
    setStatus("");
    try {
      const response = await fetch("/auth/access/token", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
      });
      if (!response.ok)
        throw new Error("Could not retrieve API token. Reauthenticate with Cloudflare Access.");
      const result = (await response.json()) as { token?: string };
      if (!result.token) throw new Error("The API did not return a token.");
      setToken(result.token);
      await copy(result.token);
    } catch (cause) {
      setError(true);
      setStatus(cause instanceof Error ? cause.message : "Could not retrieve API token.");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return (
    <DialogContainer onDismiss={onClose}>
      <Dialog size="M">
        <Heading slot="title">Settings</Heading>
        <Content>
          <div className={style({ display: "flex", flexDirection: "column", gap: 16 })}>
            <p className={style({ font: "body", margin: 0 })}>
              Your web session uses Cloudflare Access. Bookmark clients use a separate, static
              linkding-compatible API token.
            </p>
            <div
              className={style({ display: "flex", alignItems: "end", gap: 8, width: "full" })}
              onClick={(event) => {
                // A click on the field (not the icon or the label) also reveals/copies.
                if (event.target instanceof HTMLInputElement) void revealAndCopy();
              }}
            >
              <TextField
                ref={fieldRef}
                label="API token"
                type={token ? "text" : "password"}
                value={token || MASKED_TOKEN}
                isReadOnly
                autoComplete="off"
                spellCheck="false"
                styles={style({ flexGrow: 1, minWidth: 0 })}
              />
              <TooltipTrigger>
                <ActionButton
                  aria-label={token ? "Copy API token" : "Reveal and copy API token"}
                  size="M"
                  isPending={busy}
                  onPress={() => void revealAndCopy()}
                >
                  {token ? <Copy /> : <Visibility />}
                </ActionButton>
                <Tooltip>{token ? "Copy API token" : "Reveal and copy API token"}</Tooltip>
              </TooltipTrigger>
            </div>
            <p
              role="status"
              aria-live="polite"
              className={[
                style({ font: "detail", height: 56, overflow: "auto", margin: 0 }),
                error ? style({ color: "negative" }) : style({ color: "gray-700" }),
              ].join(" ")}
            >
              {status || "Click the token field or the icon to reveal and copy it."}
            </p>
          </div>
        </Content>
        <ButtonGroup>
          <Button variant="secondary" onPress={onClose}>
            Close
          </Button>
        </ButtonGroup>
      </Dialog>
    </DialogContainer>
  );
}
