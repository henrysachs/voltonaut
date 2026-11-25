import { Module, type DynamicModule } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module.js";
import { ProgressAccountDataService } from "./progress.account-data.js";
import { ProgressConsentController } from "./progress.consent.controller.js";
import { ProgressConsentService } from "./progress.consent.service.js";
import { ProgressController } from "./progress.controller.js";
import { ProgressOriginGuard } from "./progress.origin.guard.js";
import {
  ProgressCheckpointRateLimitGuard,
  progressCheckpointThrottlerModule,
} from "./progress.rate-limit.js";
import { PROGRESS_TABLES, type ProgressTables } from "./progress.schema.js";
import { ProgressService } from "./progress.service.js";

@Module({})
// oxlint-disable-next-line typescript/no-extraneous-class -- Nest dynamic modules expose their registration factory on the decorated class.
export class ProgressModule {
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Module registration passes original Drizzle metadata and Nest module references.
  public static register(tables: ProgressTables, economy: DynamicModule): DynamicModule {
    return {
      module: ProgressModule,
      imports: [AuthModule, economy, progressCheckpointThrottlerModule()],
      controllers: [ProgressConsentController, ProgressController],
      providers: [
        ProgressConsentService,
        ProgressService,
        ProgressAccountDataService,
        ProgressOriginGuard,
        ProgressCheckpointRateLimitGuard,
        { provide: PROGRESS_TABLES, useValue: tables },
      ],
      exports: [ProgressConsentService, ProgressService, ProgressAccountDataService],
    };
  }
}
