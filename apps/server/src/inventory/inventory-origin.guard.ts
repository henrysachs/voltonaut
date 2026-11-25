import { Inject, Injectable, type CanActivate } from "@nestjs/common";
import { ApiError, type ExecutionContextPort } from "../api-error.js";
import { SERVER_CONFIG, type ServerConfig } from "../config.module.js";

/** Loadout writes come only from the configured client origin (spec E7-05 AK3). */
@Injectable()
export class InventoryOriginGuard implements CanActivate {
  constructor(@Inject(SERVER_CONFIG) private readonly config: ServerConfig) {}

  public canActivate(context: ExecutionContextPort): boolean {
    const request = context
      .switchToHttp()
      .getRequest<{ readonly headers: { readonly origin?: string } }>();

    if (request.headers.origin !== this.config.clientOrigin)
      throw new ApiError(403, "forbidden", "invalid origin");

    return true;
  }
}
