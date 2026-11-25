import { Module, type DynamicModule } from "@nestjs/common";
import { ThrottlerModule } from "@nestjs/throttler";

import { AuthModule } from "../auth/auth.module.js";
import { ProgressConsentController } from "./progress.consent.controller.js";
import { ProgressConsentService } from "./progress.consent.service.js";
import { ProgressController } from "./progress.controller.js";
import { ProgressOriginGuard } from "./progress.origin.guard.js";
import {
  PROGRESS_CHECKPOINT_LIMIT,
  PROGRESS_CHECKPOINT_THROTTLER,
  PROGRESS_CHECKPOINT_TTL_MS,
  ProgressCheckpointRateLimitGuard,
  progressCheckpointTracker,
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
      imports: [
        AuthModule,
        economy,
        ThrottlerModule.forRoot([
          {
            name: PROGRESS_CHECKPOINT_THROTTLER,
            limit: PROGRESS_CHECKPOINT_LIMIT,
            ttl: PROGRESS_CHECKPOINT_TTL_MS,
            getTracker: progressCheckpointTracker,
          },
        ]),
      ],
      controllers: [ProgressConsentController, ProgressController],
      providers: [
        ProgressConsentService,
        ProgressService,
        ProgressOriginGuard,
        ProgressCheckpointRateLimitGuard,
        { provide: PROGRESS_TABLES, useValue: tables },
      ],
      exports: [ProgressConsentService, ProgressService],
    };
  }
}
