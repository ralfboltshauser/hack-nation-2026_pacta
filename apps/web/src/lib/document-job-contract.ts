import { z } from "zod";

const e164 = z.string().regex(/^\+[1-9]\d{7,14}$/);

export const documentJobRequestSchema = z
  .object({
    useCase: z
      .enum(["freight_brokerage", "contractor_bids"])
      .default("freight_brokerage"),
    customer: z
      .object({
        displayName: z.string().trim().min(1).max(100).optional(),
      })
      .strict()
      .default({}),
    suppliers: z
      .array(
        z
          .object({
            displayName: z.string().trim().min(1).max(100).optional(),
            phoneE164: e164,
          })
          .strict(),
      )
      .min(1)
      .max(3),
  })
  .strict();

export type DocumentJobRequest = z.infer<typeof documentJobRequestSchema>;
