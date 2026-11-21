import { Inject, Injectable, type CanActivate } from "@nestjs/common";
import { ApiError, type ExecutionContextPort } from "../api-error.js";
import type { AuthenticatedRequest } from "../auth/auth-request.js";
import { AccountsService } from "./accounts.service.js";

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(@Inject(AccountsService) private readonly accounts: Readonly<AccountsService>) {}

  public canActivate(context: ExecutionContextPort): boolean {
    const session = context.switchToHttp().getRequest<AuthenticatedRequest>().session;

    if (session === undefined) throw new ApiError(401, "unauthorized", "session required");
    this.accounts.requireAdmin(session.userId);

    return true;
  }
}
