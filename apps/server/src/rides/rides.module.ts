import { Module } from "@nestjs/common";
import type { DynamicModule } from "@nestjs/common";
import { ThrottlerModule } from "@nestjs/throttler";

import { RidesController } from "./rides.controller.js";
import { RidesService } from "./rides.service.js";
import { RIDES_TABLES } from "./rides.schema.js";
import type { RidesTables } from "./rides.schema.js";
import { RIDE_UPLOAD_THROTTLER, rideUploadTracker } from "./rides.rate-limit.js";

@Module({})
// oxlint-disable-next-line typescript/no-extraneous-class -- Nest dynamic modules expose their registration factory on the decorated class.
export class RidesModule {
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Module registration passes the original Drizzle table metadata into DI.
  public static register(tables: RidesTables): DynamicModule {
    return {
      module: RidesModule,
      imports: [
        ThrottlerModule.forRoot([
          {
            name: RIDE_UPLOAD_THROTTLER,
            limit: 30,
            ttl: 60_000,
            getTracker: rideUploadTracker,
          },
        ]),
      ],
      controllers: [RidesController],
      providers: [RidesService, { provide: RIDES_TABLES, useValue: tables }],
      exports: [RidesService],
    };
  }
}
