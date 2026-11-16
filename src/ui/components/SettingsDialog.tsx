import { useState } from "react";
import { DialogContainer, Dialog, Heading, Content, ButtonGroup } from "@react-spectrum/s2/Dialog";
import { Button } from "@react-spectrum/s2/Button";
import { TextField } from "@react-spectrum/s2/TextField";
import { InlineAlert } from "@react-spectrum/s2/InlineAlert";
import { style } from "@react-spectrum/s2/style" with { type: "macro" };

interface Props {
  onClose: () => void;
}

/** Token stays only in dialog component memory and is cleared on unmount. */
export function SettingsDialog({ onClose }: Props) {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  async function reveal() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/auth/access/token", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
      });
      if (!response.ok)
        throw new Error("Could not retrieve API token. Reauthenticate with Cloudflare Access.");
      const result = (await response.json()) as { token: string };
      setToken(result.token);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not retrieve API token.");
    } finally {
      setBusy(false);
    }
  }

  async function copyToken() {
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
    } catch {
      setError("Clipboard access denied. Select the token to copy it manually.");
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
            {token ? (
              <TextField label="API token" value={token} isReadOnly />
            ) : (
              <p className={style({ font: "body", color: "gray-700", margin: 0 })}>
                The API token is hidden by default. Only reveal it when configuring a client.
              </p>
            )}
            {error && (
              <InlineAlert variant="negative">
                <Heading>API token unavailable</Heading>
                <Content>{error}</Content>
              </InlineAlert>
            )}
            {copied && (
              <InlineAlert variant="positive">
                <Heading>Token copied</Heading>
                <Content>Keep this credential private.</Content>
              </InlineAlert>
            )}
          </div>
        </Content>
        <ButtonGroup>
          <Button variant="secondary" onPress={onClose}>
            Close
          </Button>
          {token ? (
            <Button variant="accent" onPress={() => void copyToken()}>
              Copy token
            </Button>
          ) : (
            <Button variant="accent" onPress={() => void reveal()} isPending={busy}>
              Reveal API token
            </Button>
          )}
        </ButtonGroup>
      </Dialog>
    </DialogContainer>
  );
}
