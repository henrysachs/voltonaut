import type { ApplicationSession } from "./sync/applicationSession.js";
import type { AuthTransport } from "./sync/authTransport.js";
import { IdentityLinks } from "./sync/identityLinks.js";
import { mountAccountPanel } from "./ui/accountPanel.js";
import { mountIdentityLinksPanel } from "./ui/identityLinksPanel.js";

type AccountSession = Readonly<
  Pick<ApplicationSession, "authorize" | "subscribe" | "login" | "logout" | "restore">
>;

/** Mounts sign-in and the connected-login section of the account menu. */
export function mountAccountPanels(
  session: AccountSession,
  transport: Readonly<Pick<AuthTransport, "mode">>,
): IdentityLinks {
  mountAccountPanel(session);

  const links = new IdentityLinks({
    session,
    providers: async () => {
      const config = await transport.mode(AbortSignal.timeout(8000));

      return config.mode === "oidc" ? config.providers : [];
    },
    redirect: (location) => {
      window.location.assign(location);
    },
  });

  mountIdentityLinksPanel(links);

  return links;
}

/** Returning from a provider with a link code: confirm the stored session, then complete it. */
export async function resumeIdentityLink(
  session: AccountSession,
  links: Readonly<Pick<IdentityLinks, "completePending" | "settle">>,
  code: string,
): Promise<void> {
  links.completePending(code);
  await session.restore();
  links.settle();
}
