import { z } from "zod";

export const MembershipSchema = z
  .object({
    tier: z.enum(["normal", "premium", "pro"]),
    vip: z.boolean(),
  })
  .strict();

export const AuthorizationSchema = z.object({ role: z.enum(["user", "admin"]) }).strict();

export const AccountStatusSchema = z
  .object({
    membership: MembershipSchema,
    authorization: AuthorizationSchema,
  })
  .strict();

export const AccountUserIdSchema = z.string().min(1);

export const AdminUsersQuerySchema = z
  .object({
    cursor: AccountUserIdSchema.optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();

const AdminUserSchema = z
  .object({
    id: AccountUserIdSchema,
    email: z.string().email(),
    displayName: z.string().nullable(),
    membership: MembershipSchema,
  })
  .strict();

export const AdminUsersSchema = z
  .object({
    users: z.array(AdminUserSchema).max(50),
    nextCursor: AccountUserIdSchema.nullable(),
  })
  .strict();

export type Membership = z.infer<typeof MembershipSchema>;

export type Authorization = z.infer<typeof AuthorizationSchema>;

export type AccountStatus = z.infer<typeof AccountStatusSchema>;

export type AdminUsersQuery = z.infer<typeof AdminUsersQuerySchema>;

export type AdminUser = z.infer<typeof AdminUserSchema>;

export type AdminUsers = z.infer<typeof AdminUsersSchema>;
