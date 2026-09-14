# Sigma email login and invitations

Invited users enter their email address, receive an eight-digit code, and enter it in the same browser. No GitHub account or password is needed in email mode. Sigma sends login emails through Brevo and stores invitations and sessions in Cloudflare D1.

**Activation is explicit.** GitHub login stays active until email delivery and the owner's invitation are ready. Set repository variable `SIGMA_AUTH_MODE=email` only after setup. Neither method permits open registration.

## One-time setup

1. Create a free [Brevo account](https://www.brevo.com/). Complete its account verification and any requested transactional-email activation.
2. Add **Sigma** as a sender using an email address you control, and complete its email verification. Brevo documents that it may substitute its own compliant sender address when using a free email address. Delivery depends on account approval and recipient filtering.
3. Generate a **Brevo API key**, not an SMTP key. Save it as repository secret `SIGMA_BREVO_API_KEY`. Never send it in chat or commit it.
4. Save the verified sender email address alone as repository secret `SIGMA_EMAIL_FROM` (no display name or angle brackets).
5. Apply `npm run db:migrate` and create the owner's invitation below. Confirm the owner's email directly; never infer an account link from a public profile or username.
6. In **Settings → Secrets and variables → Actions → Variables**, set `SIGMA_AUTH_MODE` to `email`.
7. Run **Actions → Deploy Sigma to Cloudflare → Run workflow → main**. Email credentials are checked before deployment and sent only to Worker runtime after the build.
8. Open [Sigma](https://sigma.emailabir.workers.dev/), request a code and verify delivery and login. Existing GitHub sessions require email verification after switching. Stored scans and watchlists retain their ownership.

Brevo's Free plan currently allows 300 emails/day. Sigma separately caps login emails at 100 per UTC day, five per invited address per hour, and one per address per minute window. These protect quotas and limit abuse; they do not guarantee delivery. No mailing-list subscriptions are created.

## Preserve the owner's saved data

From the repository, using Node 24 and Cloudflare CLI access:

```powershell
node scripts/invite-email.mjs OWNER_EMAIL github:43187933
```

Replace `OWNER_EMAIL` with the confirmed address. This links email login to the existing `github:43187933` data owner. The address stays in D1, not the public source repository. The person must still prove control by entering an emailed code. No automatic account linking is performed.

## Invite another person

```powershell
node scripts/invite-email.mjs PERSON_EMAIL
```

This allocates a new stable account ID. The script fails if the email or ID is already linked instead of silently merging accounts. Share the Sigma URL with that person; the script sends no invitation email. The login form sends codes only to enabled invitations.

## Remove or restore access

In Cloudflare's private D1 console, set `email_identities.enabled` to `0` for the exact address to remove access, or `1` to restore it. Every protected request checks the invitation. Do not change `user_id`: it identifies the person's stored scans and notes. Revocation preserves stored data and cannot recall information already displayed on a device.

## Security and behavior

- Codes expire in ten minutes, work once, and require the browser cookie from the request. A new code replaces the previous code for that address.
- Five wrong guesses exhaust a code. Atomic D1 counters limit sending and verification across Worker instances. Sign-in, verification, sign-out and library writes enforce request Origin checks.
- D1 stores only hashed code challenges and random 256-bit session tokens. The code hash includes a random browser secret that is not stored in D1. Raw codes go only to the delivery provider and recipient inbox, never app logs or URLs.
- Cookies use Secure, HttpOnly, SameSite=Lax and the `__Host-` prefix. Sessions last seven days, with up to five per account. Sign out revokes the current session.
- APIs, app routes and static assets remain protected. Missing credentials fail closed. Uninvited addresses receive generic confirmation but no code or session. Provider errors cannot reveal credentials or private responses.
- GitHub callbacks and old GitHub sessions cannot authenticate in email mode. For controlled rollback, set `SIGMA_AUTH_MODE=github` and redeploy with the existing OAuth secrets. See [GITHUB_LOGIN.md](GITHUB_LOGIN.md).
- The GitHub workflow applies its mode through `scripts/prepare-deploy.mjs`. A direct manual deployment must explicitly set its intended mode in the generated Worker configuration. Local credentials belong in ignored `.dev.vars`.

References: [Free plan](https://help.brevo.com/hc/en-us/articles/208589409-About-Brevo-s-pricing-plans), [sender verification](https://help.brevo.com/hc/en-us/articles/208836149-Create-a-new-sender-From-name-and-From-email), [sender substitution](https://help.brevo.com/hc/en-us/articles/14925263522578-Comply-with-Gmail-Yahoo-and-Microsoft-s-requirements-for-email-senders), [transactional API](https://developers.brevo.com/docs/send-a-transactional-email).
