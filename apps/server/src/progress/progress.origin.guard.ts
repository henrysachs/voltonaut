import { Inject, Injectable, type CanActivate } from "@nestjs/common";
import { ApiError, type ExecutionContextPort } from "../api-error.js";
import { SERVER_CONFIG, type ServerConfig } from "../config.module.js";

@Injectable()
export class ProgressOriginGuard implements CanActivate {
  constructor(@Inject(SERVER_CONFIG) private readonly config: ServerConfig) {}

  public canActivate(context: ExecutionContextPort): boolean {
    const request = context
      .switchToHttp()
      .getRequest<{ readonly headers: { readonly origin?: string } }>();

    if (request.headers.origin !== this.config.clientOrigin) {
      throw new ApiError(403, "forbidden", "invalid origin");
    }

    return true;
  }
}
