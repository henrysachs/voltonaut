import { Body, Controller, Get, Header, HttpCode, Inject, Post } from "@nestjs/common";

import {
  PurchaseRequestSchema,
  type InventoryResponse,
  type PurchaseRequest,
  type PurchaseResponse,
} from "@voltonaut/shared";
import { CurrentSession } from "../auth/auth-request.js";
import type { SessionPrincipal } from "../auth/auth-request.js";
import { ZodValidationPipe } from "../pipes/zod-validation.pipe.js";
import { InventoryService } from "./inventory.service.js";

@Controller("v1")
export class InventoryController {
  public constructor(
    @Inject(InventoryService)
    private readonly inventory: Readonly<Pick<InventoryService, "list" | "purchase">>,
  ) {}

  @Get("me/inventory")
  @Header("Cache-Control", "no-store")
  public list(@CurrentSession() session: SessionPrincipal): InventoryResponse {
    return this.inventory.list(session.userId);
  }

  @Post("shop/purchase")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  public purchase(
    @CurrentSession() session: SessionPrincipal,
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- The parsed request carries Zod primitive brands; the service only reads it.
    @Body(new ZodValidationPipe(PurchaseRequestSchema)) request: PurchaseRequest,
  ): PurchaseResponse {
    return this.inventory.purchase(session.userId, request);
  }
}
