import {
  Body,
  Controller,
  Get,
  Header,
  Inject,
  Param,
  Patch,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  AccountUserIdSchema,
  AdminUsersQuerySchema,
  MembershipSchema,
  type AccountStatus,
  type AdminUsers,
  type AdminUsersQuery,
  type Membership,
} from "@voltonaut/shared";
import { CurrentSession, type SessionPrincipal } from "../auth/auth-request.js";
import { ZodValidationPipe } from "../pipes/zod-validation.pipe.js";
import { AccountsService } from "./accounts.service.js";
import { AdminGuard } from "./admin.guard.js";
import { ClientOriginGuard } from "../client-origin.guard.js";

@Controller("v1/admin/users")
@UseGuards(AdminGuard)
export class AdminUsersController {
  constructor(@Inject(AccountsService) private readonly accounts: Readonly<AccountsService>) {}

  @Get()
  @Header("Cache-Control", "no-store")
  public list(
    @Query(new ZodValidationPipe(AdminUsersQuerySchema)) query: AdminUsersQuery,
  ): AdminUsers {
    return this.accounts.list(query);
  }

  @Patch(":userId/membership")
  @Header("Cache-Control", "no-store")
  @UseGuards(ClientOriginGuard)
  public update(
    @CurrentSession() session: SessionPrincipal,
    @Param("userId", new ZodValidationPipe(AccountUserIdSchema)) userId: string,
    @Body(new ZodValidationPipe(MembershipSchema)) membership: Membership,
  ): AccountStatus {
    return this.accounts.setMembership(session.userId, userId, membership);
  }
}
