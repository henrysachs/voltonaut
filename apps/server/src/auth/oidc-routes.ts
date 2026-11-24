import { OidcController } from "./oidc.controller.js";
import { OidcLinkController } from "./oidc-link.controller.js";
import { OidcLinkService } from "./oidc-link.service.js";
import { OidcService } from "./oidc.service.js";

/** Login and account-link controllers of the OIDC flow, registered by the auth module. */
export const OIDC_CONTROLLERS = [OidcController, OidcLinkController];

/** Services owning OIDC transactions, handoffs and identities. */
export const OIDC_SERVICES = [OidcService, OidcLinkService];
