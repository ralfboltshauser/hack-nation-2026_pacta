import { createHash, randomBytes } from "node:crypto";

import {
  compileUseCaseConfig,
  type UseCaseConfig,
} from "@pacta/use-case-config";
import { and, eq } from "drizzle-orm";

import type { PactaDatabase } from "./client";
import {
  conversations,
  jobs,
  negotiations,
  offers,
  parties,
  sessions,
  sessionSuppliers,
  useCasePartyRoles,
  useCaseConfigVersions,
  useCases,
  workspaces,
} from "./schema";

function token() {
  return randomBytes(32).toString("base64url");
}

function tokenHash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export async function publishUseCaseConfiguration(
  db: PactaDatabase,
  input: {
    workspaceSlug: string;
    workspaceName: string;
    config: UseCaseConfig;
  },
) {
  const compiled = compileUseCaseConfig(input.config);
  return db.transaction(async (tx) => {
    const [workspace] = await tx
      .insert(workspaces)
      .values({ slug: input.workspaceSlug, name: input.workspaceName })
      .onConflictDoUpdate({
        target: workspaces.slug,
        set: { name: input.workspaceName },
      })
      .returning();
    if (!workspace) throw new Error("Failed to create workspace.");
    const [useCase] = await tx
      .insert(useCases)
      .values({
        workspaceId: workspace.id,
        key: compiled.document.key,
        displayName: compiled.document.terminology.session.singular,
      })
      .onConflictDoUpdate({
        target: [useCases.workspaceId, useCases.key],
        set: { displayName: compiled.document.terminology.session.singular },
      })
      .returning();
    if (!useCase) throw new Error("Failed to create use case.");
    const [existing] = await tx
      .select()
      .from(useCaseConfigVersions)
      .where(
        and(
          eq(useCaseConfigVersions.useCaseId, useCase.id),
          eq(useCaseConfigVersions.contentSha256, compiled.contentSha256),
        ),
      );
    if (existing)
      return { workspace, useCase, configVersion: existing, inserted: false };
    const [configVersion] = await tx
      .insert(useCaseConfigVersions)
      .values({
        workspaceId: workspace.id,
        useCaseId: useCase.id,
        contractVersion: compiled.document.contractVersion,
        version: compiled.document.version,
        contentSha256: compiled.contentSha256,
        document: compiled.document,
        status: "published",
        publishedAt: new Date(),
      })
      .returning();
    if (!configVersion) throw new Error("Failed to publish configuration.");
    return { workspace, useCase, configVersion, inserted: true };
  });
}

export type SessionPartyInput = {
  partyId?: string;
  displayName?: string;
  phoneE164?: string;
  locale?: string;
  attributes?: Record<string, unknown>;
};

export async function createSourcingSession(
  db: PactaDatabase,
  input: {
    workspaceId: string;
    configVersionId: string;
    customer: SessionPartyInput;
    suppliers: SessionPartyInput[];
    customerConversation?: {
      channel: "voice" | "text_chat";
      direction: "inbound" | "outbound";
    };
    brainTokenTtlMinutes?: number;
    data?: Record<string, unknown>;
  },
) {
  const expiresAt = new Date(
    Date.now() + (input.brainTokenTtlMinutes ?? 180) * 60_000,
  );
  return db.transaction(async (tx) => {
    const [configVersion] = await tx
      .select({ useCaseId: useCaseConfigVersions.useCaseId })
      .from(useCaseConfigVersions)
      .where(
        and(
          eq(useCaseConfigVersions.id, input.configVersionId),
          eq(useCaseConfigVersions.workspaceId, input.workspaceId),
        ),
      );
    if (!configVersion)
      throw new Error(
        "Configuration does not belong to the session workspace.",
      );
    const useCaseId = configVersion.useCaseId;

    async function resolveParty(
      partyInput: SessionPartyInput,
      roleKey: "customer" | "supplier",
    ) {
      if (partyInput.partyId) {
        const [existing] = await tx
          .select({ party: parties })
          .from(useCasePartyRoles)
          .innerJoin(parties, eq(parties.id, useCasePartyRoles.partyId))
          .where(
            and(
              eq(useCasePartyRoles.workspaceId, input.workspaceId),
              eq(useCasePartyRoles.useCaseId, useCaseId),
              eq(useCasePartyRoles.partyId, partyInput.partyId),
              eq(useCasePartyRoles.roleKey, roleKey),
              eq(useCasePartyRoles.status, "active"),
              eq(parties.workspaceId, input.workspaceId),
            ),
          );
        if (!existing)
          throw new Error(
            `CRM ${roleKey} is not active for this use case and workspace.`,
          );
        return existing.party;
      }
      if (!partyInput.displayName)
        throw new Error(`An ad-hoc ${roleKey} requires a display name.`);
      const [created] = await tx
        .insert(parties)
        .values({
          workspaceId: input.workspaceId,
          roleKeys: [roleKey],
          displayName: partyInput.displayName,
          phoneE164: partyInput.phoneE164,
          locale: partyInput.locale ?? "en",
          attributes: partyInput.attributes ?? {},
        })
        .returning();
      if (!created) throw new Error(`Failed to create ${roleKey}.`);
      return created;
    }

    const customer = await resolveParty(input.customer, "customer");
    const [session] = await tx
      .insert(sessions)
      .values({
        workspaceId: input.workspaceId,
        useCaseConfigVersionId: input.configVersionId,
        customerPartyId: customer.id,
        status: "customer_intake",
        data: input.data ?? {},
        startedAt: new Date(),
      })
      .returning();
    if (!session) throw new Error("Failed to create session.");
    const [job] = await tx
      .insert(jobs)
      .values({
        workspaceId: input.workspaceId,
        sessionId: session.id,
        status: "collecting",
      })
      .returning();
    if (!job) throw new Error("Failed to create job.");

    const customerBrainToken = token();
    const [customerConversation] = await tx
      .insert(conversations)
      .values({
        workspaceId: input.workspaceId,
        sessionId: session.id,
        partyId: customer.id,
        purposeKey: "customer_intake",
        channel: input.customerConversation?.channel ?? "voice",
        direction: input.customerConversation?.direction ?? "outbound",
        provider: "elevenlabs",
        brainTokenHash: tokenHash(customerBrainToken),
        brainTokenExpiresAt: expiresAt,
        status: "created",
      })
      .returning();
    if (!customerConversation)
      throw new Error("Failed to create customer conversation.");

    const supplierGraphs = [];
    for (const [index, supplierInput] of input.suppliers.entries()) {
      const supplier = await resolveParty(supplierInput, "supplier");
      const [sessionSupplier] = await tx
        .insert(sessionSuppliers)
        .values({
          workspaceId: input.workspaceId,
          sessionId: session.id,
          supplierPartyId: supplier.id,
          priority: index,
          status: "pending",
        })
        .returning();
      if (!sessionSupplier) throw new Error("Failed to attach supplier.");
      const [negotiation] = await tx
        .insert(negotiations)
        .values({
          workspaceId: input.workspaceId,
          sessionSupplierId: sessionSupplier.id,
          phaseKey: "presenting_job",
        })
        .returning();
      if (!negotiation) throw new Error("Failed to create negotiation.");
      const [offer] = await tx
        .insert(offers)
        .values({
          workspaceId: input.workspaceId,
          negotiationId: negotiation.id,
          variantKey: "default",
          status: "draft",
        })
        .returning();
      if (!offer) throw new Error("Failed to create offer.");
      const supplierBrainToken = token();
      const [conversation] = await tx
        .insert(conversations)
        .values({
          workspaceId: input.workspaceId,
          sessionId: session.id,
          partyId: supplier.id,
          negotiationId: negotiation.id,
          purposeKey: "supplier_negotiation",
          channel: "voice",
          direction: "outbound",
          provider: "elevenlabs",
          brainTokenHash: tokenHash(supplierBrainToken),
          brainTokenExpiresAt: expiresAt,
          status: "created",
        })
        .returning();
      if (!conversation)
        throw new Error("Failed to create supplier conversation.");
      supplierGraphs.push({
        supplier,
        sessionSupplier,
        negotiation,
        offer,
        conversation,
        brainToken: supplierBrainToken,
      });
    }
    return {
      session,
      job,
      customer: {
        party: customer,
        conversation: customerConversation,
        brainToken: customerBrainToken,
      },
      suppliers: supplierGraphs,
    };
  });
}
