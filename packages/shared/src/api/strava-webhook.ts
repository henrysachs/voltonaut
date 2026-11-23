import { z } from "zod";

const IdSchema = z.number().int().positive().safe();
const TextSchema = z.string().max(512);

export const StravaWebhookEventSchema = z
  .object({
    object_type: z.string().min(1).max(64),
    object_id: IdSchema,
    aspect_type: z.string().min(1).max(64),
    owner_id: IdSchema,
    subscription_id: IdSchema,
    event_time: z.number().int().nonnegative().safe(),
    updates: z
      .object({
        authorized: TextSchema.optional(),
        title: TextSchema.optional(),
        type: TextSchema.optional(),
        private: TextSchema.optional(),
      })
      .catchall(TextSchema)
      .readonly()
      .refine(
        (value: Readonly<Record<string, string | undefined>>) => Object.keys(value).length <= 16,
      )
      .default({}),
  })
  .strict();

export type StravaWebhookEvent = z.infer<typeof StravaWebhookEventSchema>;
