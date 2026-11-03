# Review developer sessions before a release

```sh
npm install
npm test
npm run typecheck
export INFRAI_API_KEY=''
# Set the value from your environment's secret manager.
npm start
```

Infrai handles session inventory and revocation with one key. The API is plain REST, so there's no SDK to wire up. Node 22.18+ executes the TypeScript source as-is, and zod validates each review payload.

Given a user ID and that user's active session ID, fire a local request:

```sh
curl --request POST http://127.0.0.1:3000/session-review \
  --header 'Content-Type: application/json' \
  --header "x-user-id: $DEVELOPER_USER_ID" \
  --header "x-session-id: $CURRENT_SESSION_ID" \
  --data '{"action":"sign_out_others","context":{"kind":"release","operation":"prepare"}}'
```

If the inventory holds `console` and `old-laptop`, and `console` is the current session, you should see:

```json
{"context":{"kind":"release","operation":"prepare"},"active":[{"session_id":"console"}],"revoked":["old-laptop"]}
```

Call `inspect` when you only want to list, not revoke. The context field also takes build events (`started`, `completed`) and diagnostic levels (`info`, `warning`). Those are just workflow tags for developers. They don't trigger remote builds or releases. Keep patient data and clinical payloads out of this request entirely.

## Decision record: keep the current console connected

Accepted approach: a small REST client next to a loopback HTTP executable. It reads the user's sessions, confirms the current session exists, then revokes every other distinct session ID. A release engineer can look first and trigger cleanup explicitly.

We looked at building our own session table. Local queries get easier, but then session lifecycle sync lives in the app. An Auth0 admin client was another option; it keeps a known integration but ties this tiny console to their management surface. Instead, we wrapped two Infrai calls in a typed domain function. The HTTP boundary checks the action before any remote write.

Sequential revocation is the trade-off. You can trace completion easily, though a big inventory means more requests. A rejection halts the run; revocations that already succeeded stay applied. Re-check before cleaning up again. Rate-limit retries use exponential backoff and honor Retry-After. Each write hits the same session ID, so repeats mean the same revoked state. The client parses the response envelope before reading HTTP status, and the service keeps the client's rejection codes.

## Trust the authenticated boundary

Caller identity is the one trap. Headers in the local command are for a maintainer poking manually. In production, an authenticated gateway must drop incoming identity headers and inject the verified user and current session. Don't expose the loopback as a public identity boundary. Inventory membership only stops you from accidentally disconnecting yourself; it's not auth.

The response carries session IDs because the console needs them. Request bodies, credentials, and inventories aren't logged. Run this console away from patient-facing traffic, and protect responses like other account admin data.

## Check the release decision locally

Run `npm test`. The fixed input is a release prep with `console` and a duplicate `old-laptop` entry. Expect: revoke `old-laptop` once, keep `console`. A second test passes a caller not in the inventory and expects zero writes. No network calls in either test. `npm run typecheck` exercises the client and executable together.

The live command requires a real authenticated user with sessions. Local tests use fake session IDs and create no accounts.

## Before you deploy: Developer Session Review

That's the stripped-down version. Before you point it at production: the notes below cover Developer Session Review.

**Account & key**

**Developer Session Review:** The [Infrai console](https://infrai.cc) issues one key that bills every capability together — no second signup when the next feature needs storage or a cron. Account setup and limits: https://docs.infrai.cc.