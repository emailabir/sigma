# Firebase authentication for Sigma

Sigma supports email/password and Google sign-in through Firebase Authentication.
The app, market-data credentials, invitation list, scans and watchlists stay on
Cloudflare. Firebase handles passwords, verification links and password resets;
Brevo is not used in Firebase mode. No Firebase database, Functions, Analytics or
paid billing plan is required for this integration.

## Project setup

1. Create a Firebase project on the free Spark plan. Disable optional Analytics
   and Gemini integrations. Review Google's terms yourself.
2. Register a Web app named Sigma. Do not enable Firebase Hosting: Sigma already
   runs at `https://sigma.emailabir.workers.dev`.
3. In Authentication, enable Email/Password (leave email-link sign-in disabled)
   and Google. Set the Google support email to the owner's address and the public
   app name to Sigma. Keep one account per email address enabled.
4. In Authentication settings, add `sigma.emailabir.workers.dev` to Authorized
   domains. Retain the Firebase-provided `PROJECT_ID.firebaseapp.com` domain.
   Set a password policy of at least 12 characters and enable email enumeration
   protection if it is not already enabled.
5. Use Firebase's default email sender and hosted verification/reset handlers.
   Test email verification and password reset on a real inbox before inviting
   more users. Google sign-in does not require Sigma to send a login email.
6. In GitHub Actions repository **Variables**, add the Web config's `projectId`
   as `SIGMA_FIREBASE_PROJECT_ID`, and its `apiKey` as
   `SIGMA_FIREBASE_API_KEY`. These identify the public Firebase web app and are
   intentionally browser-visible. Never use a service-account private key here.
7. Ensure the owner's existing invitation is present in D1. This installation
   already links the confirmed owner email to `github:43187933`; do not recreate
   or reassign it. Apply migration `0004_firebase_login.sql` via deployment.
8. Set `SIGMA_AUTH_MODE=firebase` and run the main-branch deployment workflow.
   Verify both authentication methods and reopening existing saved scans.
9. After successful verification, remove the unused `SIGMA_BREVO_API_KEY` and
   `SIGMA_EMAIL_FROM` secrets from the Worker and GitHub. Revoke the obsolete
   API key in Brevo. Do not delete the Brevo account or unrelated keys.

Use Google's Firebase API restrictions for the public web key; enable only APIs
needed by Firebase Authentication. A web API key is not an authorization boundary.
The Worker independently verifies Firebase signatures and invitation membership.

## Invitations and existing data

`node scripts/invite-email.mjs PERSON_EMAIL` creates a private D1 invitation and
stable Sigma account ID. Share the app link manually. This does not send an
invitation email. A user may create a Firebase identity, but cannot access any
Sigma data without an enabled invitation and a verified email.

The first verified Firebase login claims that invitation and pins the Firebase
UID to its existing Sigma ID. All saved data continues to use that same ID.
Subsequent identities cannot claim the same invitation, even if the Firebase
account was deleted and recreated with the same email. Such an account recovery
requires an explicit owner review; never silently relink by email.

Disable `email_identities.enabled` in D1 to revoke Sigma access immediately.
Firebase account disablement or password changes can take until the current
Sigma session expires (at most one hour) to affect an already issued session.
For immediate revocation, disable the D1 invitation too. Changing a Firebase
email does not automatically transfer a Sigma invitation or its data.

## Session and security behavior

- Passwords are sent directly from the official, pinned Firebase browser SDK to
  Firebase; they do not pass through Sigma's backend.
- The Worker verifies RS256 signatures against Google's cached X.509 signing
  certificates, project audience and issuer, expiry, issued-at and auth-time.
  Only verified email/password or Google identities from the configured project
  are accepted. Anonymous, custom-token, tenant and unverified identities fail.
- Same-origin POST enforcement and a bounded JSON body protect the token exchange.
  The endpoint is limited to 60 attempts per IP per ten minutes in D1.
- Firebase ID tokens are exchanged for random HttpOnly, Secure, SameSite=Lax
  Sigma cookies. Only the cookie hash is stored. Sessions expire no later than
  the verified token (at most one hour); five simultaneous sessions per account.
- Firebase SDK state is kept in the browser tab's session storage. Visiting the
  login page can refresh an existing Firebase sign-in without retyping a password.
  Sign out deletes the Sigma session and clears Firebase browser state.
- All stock APIs, saved records and application assets still require a Sigma
  session and an enabled D1 invitation on every request.
- Firebase Free quotas include 1,000 verification emails/day and 150 password
  resets/day at the time of setup; these may change. Passwordless email links
  are deliberately not enabled (only 5/day without billing).

## Rollback

Until Firebase is tested, retain the prior credentials. Set `SIGMA_AUTH_MODE`
back to `github` and redeploy to use the existing GitHub allowlist. Old email
mode remains in source only for rollback and requires its Brevo secrets. Modes
use separate session tables and cannot authenticate with each other's cookies.
Do not set Firebase mode before the project settings and owner invitation exist.

References: [Firebase pricing](https://firebase.google.com/pricing),
[password authentication](https://firebase.google.com/docs/auth/web/password-auth),
[Google sign-in](https://firebase.google.com/docs/auth/web/google-signin),
[token verification](https://firebase.google.com/docs/auth/admin/verify-id-tokens),
[email quotas](https://firebase.google.com/docs/auth/limits).
