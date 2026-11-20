import { Inject, Injectable } from "@nestjs/common";
import { DRIZZLE } from "./drizzle.provider.js";
import type { ServerDatabase } from "./drizzle.provider.js";

@Injectable()
export class DatabaseLifecycle {
  public constructor(
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Drizzle owns the mutable SQLite connection.
    @Inject(DRIZZLE) private readonly db: ServerDatabase,
  ) {}

  public onModuleDestroy(): void {
    if (this.db.$client.open) {
      this.db.$client.close();
    }
  }
}
