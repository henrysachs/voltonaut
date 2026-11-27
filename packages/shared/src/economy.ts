import { z } from "zod";

import { RewardFactsSchema } from "./rewards.js";

const safeNonnegativeInteger = z.number().finite().int().min(0).max(Number.MAX_SAFE_INTEGER);

export const VoltsBalanceSchema = safeNonnegativeInteger.brand<"VoltsBalance">();

export const VoltsAmountSchema = safeNonnegativeInteger.brand<"VoltsAmount">();

export const VoltsDebitAmountSchema = z
  .number()
  .finite()
  .int()
  .min(1)
  .max(Number.MAX_SAFE_INTEGER)
  .brand<"VoltsDebitAmount">();

export const VoltsDeltaSchema = z
  .number()
  .finite()
  .int()
  .min(-Number.MAX_SAFE_INTEGER)
  .max(Number.MAX_SAFE_INTEGER)
  .brand<"VoltsDelta">();

export const VoltsIdempotencyKeySchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u)
  .brand<"VoltsIdempotencyKey">();

export const VoltsRewardDaySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/u)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);

    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, "Reward day must be a real UTC calendar date")
  .brand<"VoltsRewardDay">();

export const JournalIdSchema = z.string().uuid().toLowerCase().brand<"JournalId">();

export const VoltsRideRangeCommandSchema = z
  .object({
    journalId: JournalIdSchema,
    startTick: safeNonnegativeInteger,
    endTick: safeNonnegativeInteger,
    rewardDay: VoltsRewardDaySchema,
    cumulativeFacts: RewardFactsSchema,
  })
  .strict()
  .readonly()
  .refine(
    (command: Readonly<{ startTick: number; endTick: number }>) =>
      command.endTick > command.startTick,
    {
      message: "End tick must be after start tick",
      path: ["endTick"],
    },
  );

export const VoltsDebitCommandSchema = z
  .object({
    idempotencyKey: VoltsIdempotencyKeySchema.refine((key) => key.startsWith("purchase:"), {
      message: "Debit idempotency key must start with purchase:",
    }),
    refId: z.string().min(1).max(200),
    amountVolts: VoltsDebitAmountSchema,
  })
  .strict()
  .readonly();

/** Operator credit from the admin CLI (spec E7-02 AK7); keys start with `operator:`. */
export const VoltsGrantCommandSchema = z
  .object({
    idempotencyKey: VoltsIdempotencyKeySchema.refine((key) => key.startsWith("operator:"), {
      message: "Grant idempotency key must start with operator:",
    }),
    refId: z.string().min(1).max(200),
    amountVolts: VoltsDebitAmountSchema,
    /** Active admin account that issued the credit (issue #116). */
    operatorUserId: z.string().min(1).max(200),
  })
  .strict()
  .readonly();

/** Who issued a credit; grants booked before the audit existed stay explicitly unknown. */
export const VoltsGrantOperatorSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("recorded"), userId: z.string().min(1).max(200) }).strict(),
  z.object({ kind: z.literal("unknown_before_audit") }).strict(),
]);

export const VoltsRideRangeReceiptSchema = z
  .object({
    entryId: z.string().uuid(),
    journalId: JournalIdSchema,
    startTick: safeNonnegativeInteger,
    endTick: safeNonnegativeInteger,
    rewardDay: VoltsRewardDaySchema,
    cumulativeWorkVolts: VoltsAmountSchema,
    cumulativeClimbVolts: VoltsAmountSchema,
    candidateVolts: VoltsAmountSchema,
    awardedVolts: VoltsAmountSchema,
    withheldVolts: VoltsAmountSchema,
  })
  .strict()
  .readonly()
  .refine(
    (receipt: Readonly<{ startTick: number; endTick: number }>) =>
      receipt.endTick > receipt.startTick,
    {
      message: "End tick must be after start tick",
      path: ["endTick"],
    },
  )
  .refine(
    (
      receipt: Readonly<{
        awardedVolts: number;
        withheldVolts: number;
        candidateVolts: number;
      }>,
    ) => receipt.awardedVolts + receipt.withheldVolts === receipt.candidateVolts,
    {
      message: "Awarded and withheld Volts must equal the candidate",
      path: ["candidateVolts"],
    },
  );

export const VoltsDebitReceiptSchema = z
  .object({
    entryId: z.string().uuid(),
    refId: z.string().min(1).max(200),
    amountVolts: VoltsDebitAmountSchema,
  })
  .strict()
  .readonly();

export const VoltsGrantReceiptSchema = z
  .object({
    entryId: z.string().uuid(),
    refId: z.string().min(1).max(200),
    amountVolts: VoltsDebitAmountSchema,
    operator: VoltsGrantOperatorSchema,
  })
  .strict()
  .readonly();

const VoltsLedgerEntryBaseSchema = z
  .object({
    id: z.string().uuid(),
    deltaVolts: VoltsDeltaSchema,
    refId: z.string().min(1).max(200),
    idempotencyKey: VoltsIdempotencyKeySchema,
    payloadHash: z.string().regex(/^[a-f0-9]{64}$/u),
    createdAt: z.string().datetime({ precision: 3 }),
  })
  .strict();

type ExportEntryValidation = Readonly<
  | { reason: "ride_reward"; deltaVolts: number; startTick: number; endTick: number }
  | { reason: "purchase"; deltaVolts: number }
  | { reason: "operator_grant"; deltaVolts: number }
>;

function validateExportEntry(
  entry: ExportEntryValidation,
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Zod owns this callback context; validation only calls addIssue.
  context: Readonly<z.RefinementCtx>,
): void {
  if (
    entry.reason === "ride_reward" &&
    (entry.deltaVolts < 0 || entry.endTick <= entry.startTick)
  ) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid ride reward export" });
  }

  if (entry.reason === "purchase" && entry.deltaVolts >= 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid purchase export" });
  }

  if (entry.reason === "operator_grant" && entry.deltaVolts <= 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid operator grant export" });
  }
}

const VoltsLedgerExportEntrySchema = z
  .discriminatedUnion("reason", [
    VoltsLedgerEntryBaseSchema.extend({
      reason: z.literal("ride_reward"),
      rewardDay: VoltsRewardDaySchema,
      startTick: VoltsAmountSchema,
      endTick: VoltsAmountSchema,
      candidateVolts: VoltsAmountSchema,
      cumulativeWorkVolts: VoltsAmountSchema,
      cumulativeClimbVolts: VoltsAmountSchema,
      cumulativeFacts: RewardFactsSchema,
    }).strict(),
    VoltsLedgerEntryBaseSchema.extend({
      reason: z.literal("purchase"),
    }).strict(),
    VoltsLedgerEntryBaseSchema.extend({
      reason: z.literal("operator_grant"),
    }).strict(),
  ])
  .superRefine(validateExportEntry)
  .readonly();

export const VoltsAccountExportSchema = z
  .object({
    balance: VoltsBalanceSchema,
    journal: z.array(VoltsLedgerExportEntrySchema),
  })
  .strict()
  .readonly();

export type VoltsGrantCommand = z.infer<typeof VoltsGrantCommandSchema>;

export type VoltsGrantReceipt = z.infer<typeof VoltsGrantReceiptSchema>;

export type VoltsGrantOperator = z.infer<typeof VoltsGrantOperatorSchema>;

export type VoltsAccountExport = z.infer<typeof VoltsAccountExportSchema>;

export type VoltsBalance = z.infer<typeof VoltsBalanceSchema>;

export type VoltsAmount = z.infer<typeof VoltsAmountSchema>;

export type VoltsDebitAmount = z.infer<typeof VoltsDebitAmountSchema>;

export type VoltsDelta = z.infer<typeof VoltsDeltaSchema>;

export type VoltsIdempotencyKey = z.infer<typeof VoltsIdempotencyKeySchema>;

export type VoltsRewardDay = z.infer<typeof VoltsRewardDaySchema>;

export type JournalId = z.infer<typeof JournalIdSchema>;

export type VoltsRideRangeCommand = z.infer<typeof VoltsRideRangeCommandSchema>;

export type VoltsDebitCommand = z.infer<typeof VoltsDebitCommandSchema>;

export type VoltsRideRangeReceipt = z.infer<typeof VoltsRideRangeReceiptSchema>;

export type VoltsDebitReceipt = z.infer<typeof VoltsDebitReceiptSchema>;
