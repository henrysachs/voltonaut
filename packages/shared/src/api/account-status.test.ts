import { expect, it } from "vitest";
import { AccountStatusSchema, AdminUsersQuerySchema, MembershipSchema } from "./account-status.js";

it.each(["normal", "premium", "pro"])(
  "keeps %s membership independent of VIP and authorization",
  (tier) => {
    for (const vip of [true, false]) {
      expect(MembershipSchema.parse({ tier, vip })).toEqual({ tier, vip });
      expect(
        AccountStatusSchema.parse({ membership: { tier, vip }, authorization: { role: "user" } })
          .authorization.role,
      ).toBe("user");
    }
  },
);

it("rejects privilege fields, incomplete writes and unbounded directory queries", () => {
  expect(MembershipSchema.safeParse({ tier: "pro", vip: true, role: "admin" }).success).toBe(false);
  expect(MembershipSchema.safeParse({ tier: "normal" }).success).toBe(false);
  expect(MembershipSchema.safeParse({ tier: "vip", vip: true }).success).toBe(false);
  expect(AdminUsersQuerySchema.parse({}).limit).toBe(20);

  for (const limit of [0, 51, 1.5, "all"])
    expect(AdminUsersQuerySchema.safeParse({ limit }).success).toBe(false);
});
