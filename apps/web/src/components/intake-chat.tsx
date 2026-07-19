"use client";

import { ConversationProvider, useConversation } from "@elevenlabs/react";
import {
  ArrowLeft,
  CheckCircle2,
  FileText,
  LoaderCircle,
  MessageCircle,
  Send,
  Upload,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import type { FormEvent } from "react";

import { ensureSessionAccess } from "@/lib/supabase/session-access";
import { useSessionEvents } from "@/lib/supabase/use-session-events";

type ChatMessage = {
  id: string;
  role: "assistant" | "user";
  text: string;
  filename?: string;
};
type ChatSession = {
  signedUrl: string;
  customLlmExtraBody: Record<string, unknown>;
  error?: string;
};
type StagedArtifact = {
  artifactId: string;
  marker: string;
  filename: string;
  error?: string;
};

export function IntakeChat({ sessionId }: { sessionId: string }) {
  return (
    <ConversationProvider textOnly serverLocation="global">
      <IntakeChatSession sessionId={sessionId} />
    </ConversationProvider>
  );
}

function IntakeChatSession({ sessionId }: { sessionId: string }) {
  const live = useSessionEvents(sessionId);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [message, setMessage] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [bound, setBound] = useState(false);
  const accessHeaders = useRef<Record<string, string> | null>(null);
  const turnId = useRef<string | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const bindConversation = useCallback(
    async (providerConversationId: string) => {
      const headers = accessHeaders.current;
      if (!headers)
        throw new Error(
          "The authenticated session expired before the chat connected.",
        );
      const response = await fetch(`/api/sessions/${sessionId}/chat/bind`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ providerConversationId }),
      });
      if (!response.ok)
        throw new Error(
          `ElevenLabs conversation binding failed (${response.status}).`,
        );
      setBound(true);
    },
    [sessionId],
  );

  const conversation = useConversation({
    textOnly: true,
    onConnect: ({ conversationId }) => {
      void bindConversation(conversationId).catch((caught) =>
        setError(
          caught instanceof Error ? caught.message : "Chat binding failed.",
        ),
      );
    },
    onDisconnect: () => setBound(false),
    onError: (reason) =>
      setError(
        typeof reason === "string"
          ? reason
          : "The ElevenLabs chat session failed.",
      ),
    onMessage: (event) => {
      if (event.source !== "ai" || !event.message) return;
      setMessages((current) => [
        ...current,
        {
          id: `agent:${event.event_id ?? crypto.randomUUID()}`,
          role: "assistant",
          text: event.message,
        },
      ]);
      setSending(false);
    },
  });

  function resetTurnIdentity() {
    turnId.current = null;
    setError(null);
  }

  async function connect() {
    setError(null);
    try {
      const access = await ensureSessionAccess(sessionId);
      accessHeaders.current = access.headers;
      const response = await fetch(`/api/sessions/${sessionId}/chat/session`, {
        method: "POST",
        headers: access.headers,
      });
      const body = (await response.json()) as ChatSession;
      if (!response.ok)
        throw new Error(
          body.error ?? `Customer chat could not start (${response.status}).`,
        );
      conversation.startSession({
        signedUrl: body.signedUrl,
        connectionType: "websocket",
        textOnly: true,
        customLlmExtraBody: body.customLlmExtraBody,
        userId: `pacta-session-${sessionId}`,
      });
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Customer chat could not start.",
      );
    }
  }

  async function stageFile(input: File) {
    const headers = accessHeaders.current;
    if (!headers)
      throw new Error(
        "Connect the ElevenLabs chat before attaching a document.",
      );
    turnId.current ??= crypto.randomUUID();
    const form = new FormData();
    form.set("turnId", turnId.current);
    form.set("file", input);
    const response = await fetch(`/api/sessions/${sessionId}/artifacts`, {
      method: "POST",
      headers,
      body: form,
    });
    const body = (await response.json()) as StagedArtifact;
    if (!response.ok)
      throw new Error(
        body.error ?? `Private document staging failed (${response.status}).`,
      );
    return body;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const text = message.trim();
    if ((!text && !file) || sending || !bound) return;
    setSending(true);
    setError(null);
    turnId.current ??= crypto.randomUUID();
    try {
      const visibleText =
        text || "Please extract the configured job details from this document.";
      if (file) {
        const staged = await stageFile(file);
        const uploaded = await conversation.uploadFile(file);
        conversation.sendMultimodalMessage({
          text: `${visibleText}\n\n${staged.marker}`,
          fileId: uploaded.fileId,
        });
      } else {
        conversation.sendUserMessage(visibleText);
      }
      setMessages((current) => [
        ...current,
        {
          id: `user:${turnId.current}`,
          role: "user",
          text: visibleText,
          ...(file ? { filename: file.name } : {}),
        },
      ]);
      setMessage("");
      setFile(null);
      if (fileInput.current) fileInput.current.value = "";
      turnId.current = null;
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The ElevenLabs chat turn failed.",
      );
      setSending(false);
    }
  }

  const job = live.view?.job ?? null;
  const connected = conversation.status === "connected" && bound;

  return (
    <main className="intake-page">
      <header className="intake-header">
        <Link
          href={`/?session=${sessionId}`}
          aria-label="Back to negotiation room"
        >
          <ArrowLeft size={16} />
        </Link>
        <div className="brand">
          <span className="brand-mark">P</span>
          <strong>Pacta</strong>
          <small>ElevenLabs customer chat</small>
        </div>
        <span
          className={`intake-live is-${connected ? "live" : conversation.status}`}
        >
          <i />
          {connected ? "Agent connected" : conversation.status}
        </span>
      </header>

      <section className="intake-layout">
        <div className="intake-chat-panel">
          <div className="intake-intro">
            <span>ELEVENLABS CHAT · CONFIG-DRIVEN INTAKE</span>
            <h1>Let’s define the job.</h1>
            <p>
              Chat and PDF/image evidence flow through the same HTTP Custom LLM
              and verified job reducer used by every negotiation.
            </p>
          </div>
          <div className="intake-messages" aria-live="polite">
            {!connected && conversation.status === "disconnected" && (
              <article className="intake-connect-card">
                <MessageCircle size={21} />
                <strong>Start the customer chat</strong>
                <p>
                  This opens a private text-only ElevenLabs conversation. It
                  cannot originate a phone call.
                </p>
                <button type="button" onClick={() => void connect()}>
                  Connect agent
                </button>
              </article>
            )}
            {conversation.status === "connecting" && (
              <article className="intake-message is-assistant is-loading">
                <LoaderCircle className="spin" size={14} /> Connecting to
                ElevenLabs…
              </article>
            )}
            {messages.map((item) => (
              <article
                className={`intake-message is-${item.role}`}
                key={item.id}
              >
                <small>{item.role === "assistant" ? "Pacta" : "You"}</small>
                {item.filename && (
                  <span className="intake-file-chip">
                    <FileText size={13} />
                    {item.filename}
                  </span>
                )}
                <p>{item.text}</p>
              </article>
            ))}
            {sending && (
              <article className="intake-message is-assistant is-loading">
                <LoaderCircle className="spin" size={14} /> Reading the current
                evidence…
              </article>
            )}
          </div>
          <form className="intake-composer" onSubmit={submit}>
            {file && (
              <div className="intake-selected-file">
                <FileText size={14} />
                <span>{file.name}</span>
                <button
                  type="button"
                  onClick={() => {
                    setFile(null);
                    resetTurnIdentity();
                    if (fileInput.current) fileInput.current.value = "";
                  }}
                >
                  Remove
                </button>
              </div>
            )}
            <textarea
              aria-label="Customer message"
              value={message}
              onChange={(event) => {
                setMessage(event.target.value);
                resetTurnIdentity();
                if (connected) conversation.sendUserActivity();
              }}
              placeholder={
                connected
                  ? "Add details, answer the question, or explicitly confirm the completed job…"
                  : "Connect the ElevenLabs agent to begin…"
              }
              rows={3}
              disabled={!connected}
            />
            <div className="intake-composer-actions">
              <label
                className={`intake-upload${connected ? "" : " is-disabled"}`}
              >
                <Upload size={15} /> Attach PDF or image
                <input
                  ref={fileInput}
                  type="file"
                  accept="application/pdf,image/jpeg,image/png,image/webp"
                  disabled={!connected}
                  onChange={(event) => {
                    setFile(event.target.files?.[0] ?? null);
                    resetTurnIdentity();
                  }}
                />
              </label>
              <button
                className="intake-send"
                type="submit"
                disabled={sending || !connected || (!message.trim() && !file)}
              >
                {sending ? (
                  <LoaderCircle className="spin" size={15} />
                ) : (
                  <Send size={15} />
                )}
                {error ? "Retry" : "Send"}
              </button>
            </div>
            {error && (
              <p className="intake-error">
                {error}
                {turnId.current
                  ? " The exact document turn ID is retained for a safe retry."
                  : ""}
              </p>
            )}
          </form>
        </div>

        <aside className="intake-job-panel">
          <div className="intake-job-heading">
            <span>STRUCTURED JOB</span>
            {job?.confirmed ? (
              <strong className="is-confirmed">
                <CheckCircle2 size={14} /> Confirmed
              </strong>
            ) : (
              <strong>
                {job?.status?.replaceAll("_", " ") ?? "collecting"}
              </strong>
            )}
          </div>
          <pre>{JSON.stringify(job?.data ?? {}, null, 2)}</pre>
          <div className="intake-missing">
            <span>Still required</span>
            {job?.missingRequiredPaths.length ? (
              job.missingRequiredPaths.map((path) => (
                <code key={path}>{path}</code>
              ))
            ) : (
              <p>
                {job
                  ? "No required fields are missing. Explicit confirmation is still required unless shown above."
                  : "The configured field checklist appears after the first turn."}
              </p>
            )}
          </div>
        </aside>
      </section>
    </main>
  );
}
