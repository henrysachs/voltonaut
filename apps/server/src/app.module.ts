import { Module } from "@nestjs/common";

import { HealthModule } from "./health/health.module.js";

@Module({
  imports: [HealthModule],
})
// oxlint-disable-next-line typescript/no-extraneous-class -- Nest modules are empty decorated classes; the framework reads the decorator, not class members.
export class AppModule {}
