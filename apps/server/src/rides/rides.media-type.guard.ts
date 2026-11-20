import { Injectable } from "@nestjs/common";
import type { IncomingHttpHeaders } from "node:http";
import { z } from "zod";

import { ApiError } from "../api-error.js";
import type { ExecutionContextPort } from "../api-error.js";

const UploadHeadersSchema = z.object({
  "content-type": z.string().regex(/^\s*application\/json\s*(?:;.*)?$/iu),
  "content-encoding": z.string().toLowerCase().pipe(z.literal("identity")).optional(),
});

@Injectable()
export class RideUploadMediaTypeGuard {
  public canActivate(context: ExecutionContextPort): boolean {
    const request = context
      .switchToHttp()
      .getRequest<{ readonly headers: Readonly<IncomingHttpHeaders> }>();

    if (!UploadHeadersSchema.safeParse(request.headers).success) {
      throw new ApiError(415, "unsupported_media_type", "uncompressed application/json required");
    }

    return true;
  }
}
