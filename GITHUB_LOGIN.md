# Sigma GitHub login (fallback)

See [LOGIN.md](LOGIN.md) for email login. GitHub remains active until email delivery and invitations are ready and the deployment variable is switched.

Sigma uses **Sign in with GitHub**. Each invited person needs a GitHub account. There is no Cloudflare Zero Trust subscription, card entry, password database, or email delivery service to configure.

## One-time owner setup

1. Open [GitHub OAuth app registration](https://github.com/settings/applications/new).
2. Name: **Sigma**. Homepage: `https://sigma.emailabir.workers.dev`. Callback: `https://sigma.emailabir.workers.dev/auth/callback`.
3. Leave **Allow wildcard matching** and **Enable Device Flow** disabled. Keep **Expire user access tokens** enabled. Register the application.
4. Generate a client secret. In [Sigma's repository Secrets](https://github.com/emailabir/sigma/settings/secrets/actions), save the **Client ID** as `SIGMA_GITHUB_CLIENT_ID` and the **Client secret** as `SIGMA_GITHUB_CLIENT_SECRET`. These are different from `CLOUDFLARE_API_TOKEN` and the Alpaca keys. Never commit their values.
5. Run **Actions → Deploy Sigma to Cloudflare → Run workflow → main**. It applies the session database migration and sends the secrets to the Worker after building.
6. Open [Sigma](https://sigma.emailabir.workers.dev) and click **Sign in with GitHub**. The current invitation list contains only the owner's numeric account ID, `43187933` (`emailabir`).

The OAuth app asks for public identity only, with no repository or private-email scope. The provider's access/refresh tokens are used only during callback processing and never saved in D1, browser storage, or the app's session cookie.

## Invite someone

Ask for their GitHub username. Verify the account with the person, then get its numeric `id` from `https://api.github.com/users/USERNAME` (replace USERNAME). Add that ID to the comma-separated `SIGMA_GITHUB_USER_IDS` value in `wrangler.jsonc`, commit and deploy. Share the Sigma URL with that person. There is no automated invitation email.

Use numeric IDs, not usernames: usernames can change or be reassigned. Each account's saved data uses the stable `github:ID` key. The displayed username is informational.

## Remove access

Remove the numeric ID from `SIGMA_GITHUB_USER_IDS` and deploy. The list is checked on every protected request, so existing sessions no longer grant access. Previously rendered information cannot be recalled from a person's device. Stored scans and notes remain unless separately deleted.

**Sign out** removes the current server session and clears the browser cookie. Sessions expire after seven days and are limited to five per account. New sign-ins rotate the current cookie. To revoke every session immediately, an administrator can clear the `auth_sessions` table through D1; saved scans and watchlist tables are separate.

## Implementation and limits

- Authorization-code flow uses state plus S256 PKCE, a fixed HTTPS origin and exact callback URL. A ten-minute encrypted HttpOnly cookie holds only the transient state and verifier; GitHub accepts each authorization code once.
- D1 stores only SHA-256 hashes of random 256-bit session tokens. Session cookies use the `__Host-` prefix, Secure, HttpOnly and SameSite=Lax.
- Public login pages have a restrictive Content Security Policy. All responses containing user data use `private, no-store`. Sign-in, sign-out and library writes reject cross-origin POST requests.
- Missing configuration denies data access. Uninvited OAuth profiles never receive a session. Caller-supplied identity headers are ignored.
- Invitations and session ownership are separate from GitHub repository access. The source repository can remain public while Sigma stays private.
- The previous Cloudflare Access implementation was never activated. No saved data is automatically linked from an Access identity or by matching email.

References: [GitHub OAuth registration](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app), [authorization flow and PKCE](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps).
