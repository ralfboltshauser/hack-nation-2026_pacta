import "server-only";

import { createHash } from "node:crypto";

import {
  artifacts,
  conversations,
  sessions,
  type PactaDatabase,
} from "@pacta/db";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import type { BegunBrainTurn } from "@/server/brain/persistence";
import { createSupabaseAdmin } from "@/server/supabase/admin";

const maximumFileBytes = 4_000_000;
const allowedMediaTypes = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const turnIdSchema = z.string().uuid();
const markerPattern =
  /\[PACTA_PRIVATE_ARTIFACT:([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\]/i;

export class ArtifactRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function hash(value: Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

function filename(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata))
    return "document";
  const value = (metadata as Record<string, unknown>).filename;
  return typeof value === "string" && value ? value : "document";
}

export function artifactMarker(artifactId: string) {
  return `[PACTA_PRIVATE_ARTIFACT:${artifactId}]`;
}

export function artifactIdFromMessages(messages: Array<{ content: unknown }>) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const match = JSON.stringify(messages[index]?.content).match(markerPattern);
    if (match?.[1]) return match[1].toLowerCase();
  }
  return null;
}

export function stripArtifactMarker(value: string) {
  return value.replace(markerPattern, "").trim();
}

export async function stageIntakeArtifact(
  db: PactaDatabase,
  sessionId: string,
  form: FormData,
  dependencies: {
    upload?: (input: {
      bucket: string;
      objectKey: string;
      bytes: Uint8Array;
      mediaType: string;
    }) => Promise<void>;
  } = {},
) {
  const parsedTurnId = turnIdSchema.safeParse(form.get("turnId"));
  if (!parsedTurnId.success)
    throw new ArtifactRequestError("A UUID turnId is required.", 422);
  const raw = form.get("file");
  if (!(raw instanceof File))
    throw new ArtifactRequestError("A PDF or image file is required.", 422);
  if (raw.size === 0)
    throw new ArtifactRequestError("The uploaded file is empty.", 422);
  if (raw.size > maximumFileBytes)
    throw new ArtifactRequestError(
      "Files must be smaller than 4 MB for the MVP upload path.",
      413,
    );
  if (!allowedMediaTypes.has(raw.type))
    throw new ArtifactRequestError(
      "Only PDF, JPEG, PNG, and WebP files are supported by ElevenLabs file input.",
      415,
    );

  const [row] = await db
    .select({ session: sessions, conversation: conversations })
    .from(sessions)
    .innerJoin(
      conversations,
      and(
        eq(conversations.sessionId, sessions.id),
        eq(conversations.partyId, sessions.customerPartyId),
        eq(conversations.purposeKey, "customer_intake"),
      ),
    )
    .where(eq(sessions.id, sessionId));
  if (!row)
    throw new ArtifactRequestError(
      "Session customer conversation was not found.",
      404,
    );
  if (row.session.status !== "customer_intake")
    throw new ArtifactRequestError(
      "Documents can only be added during customer intake.",
      409,
    );

  const bytes = new Uint8Array(await raw.arrayBuffer());
  const sha256 = hash(bytes);
  const artifactId = parsedTurnId.data;
  const [existing] = await db
    .select()
    .from(artifacts)
    .where(eq(artifacts.id, artifactId));
  if (existing) {
    if (
      existing.workspaceId !== row.session.workspaceId ||
      existing.sessionId !== sessionId ||
      existing.sha256 !== sha256
    ) {
      throw new ArtifactRequestError(
        "This turn ID was already used for a different upload.",
        409,
      );
    }
    return {
      artifactId,
      marker: artifactMarker(artifactId),
      filename: filename(existing.metadata),
    };
  }

  const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? "pacta-private";
  const objectKey = `${row.session.workspaceId}/${sessionId}/${artifactId}/source`;
  if (dependencies.upload) {
    await dependencies.upload({
      bucket,
      objectKey,
      bytes,
      mediaType: raw.type,
    });
  } else {
    const supabase = createSupabaseAdmin();
    const uploaded = await supabase.storage
      .from(bucket)
      .upload(objectKey, bytes, { contentType: raw.type, upsert: true });
    if (uploaded.error)
      throw new Error(
        `Private document upload failed: ${uploaded.error.message}`,
      );
  }
  await db
    .insert(artifacts)
    .values({
      id: artifactId,
      workspaceId: row.session.workspaceId,
      sessionId,
      kind: "customer_intake_document",
      storageProvider: "supabase",
      bucket,
      objectKey,
      mimeType: raw.type,
      sizeBytes: bytes.byteLength,
      sha256,
      sourcePartyId: row.session.customerPartyId,
      sourceConversationId: row.conversation.id,
      metadata: { filename: raw.name.slice(0, 255) || "document" },
    })
    .onConflictDoNothing({ target: artifacts.id });
  const [committed] = await db
    .select()
    .from(artifacts)
    .where(eq(artifacts.id, artifactId));
  if (!committed || committed.sha256 !== sha256)
    throw new Error(
      "Uploaded document metadata could not be committed safely.",
    );
  return {
    artifactId,
    marker: artifactMarker(artifactId),
    filename: filename(committed.metadata),
  };
}

export async function loadIntakeArtifact(
  db: PactaDatabase,
  begun: BegunBrainTurn,
  artifactId: string,
) {
  const [artifact] = await db
    .select()
    .from(artifacts)
    .where(
      and(
        eq(artifacts.id, artifactId),
        eq(artifacts.workspaceId, begun.workspaceId),
        eq(artifacts.sessionId, begun.sessionId),
        eq(artifacts.sourceConversationId, begun.conversationId),
        eq(artifacts.kind, "customer_intake_document"),
      ),
    );
  if (!artifact)
    throw new ArtifactRequestError(
      "The private document reference is invalid for this conversation.",
      403,
    );
  const supabase = createSupabaseAdmin();
  const downloaded = await supabase.storage
    .from(artifact.bucket)
    .download(artifact.objectKey);
  if (downloaded.error)
    throw new Error(
      `Private document download failed: ${downloaded.error.message}`,
    );
  const bytes = new Uint8Array(await downloaded.data.arrayBuffer());
  if (hash(bytes) !== artifact.sha256)
    throw new Error("Private document integrity verification failed.");
  return {
    artifactId: artifact.id,
    data: bytes,
    filename: filename(artifact.metadata),
    mediaType: artifact.mimeType,
  };
}
