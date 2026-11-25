import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Post,
  Put,
  UseGuards,
} from "@nestjs/common";

import {
  LoadoutUpdateSchema,
  PurchaseRequestSchema,
  type LoadoutResponse,
  type LoadoutUpdate,
  type InventoryResponse,
  type PurchaseRequest,
  type PurchaseResponse,
} from "@voltonaut/shared";
import { CurrentSession } from "../auth/auth-request.js";
import type { SessionPrincipal } from "../auth/auth-request.js";
import { ZodValidationPipe } from "../pipes/zod-validation.pipe.js";
import { InventoryOriginGuard } from "./inventory-origin.guard.js";
import { LoadoutService } from "./inventory.loadout.js";
import { InventoryService } from "./inventory.service.js";

@Controller("v1")
export class InventoryController {
  public constructor(
    @Inject(InventoryService)
    private readonly inventory: Readonly<Pick<InventoryService, "list" | "purchase">>,
    @Inject(LoadoutService)
    private readonly loadouts: Readonly<Pick<LoadoutService, "get" | "save">>,
  ) {}

  @Get("me/loadout")
  @Header("Cache-Control", "no-store")
  public loadout(@CurrentSession() session: SessionPrincipal): LoadoutResponse {
    return this.loadouts.get(session.userId);
  }

  @Put("me/loadout")
  @UseGuards(InventoryOriginGuard)
  @Header("Cache-Control", "no-store")
  public saveLoadout(
    @CurrentSession() session: SessionPrincipal,
    @Body(new ZodValidationPipe(LoadoutUpdateSchema)) update: LoadoutUpdate,
  ): LoadoutResponse {
    return this.loadouts.save(session.userId, update);
  }

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
