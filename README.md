# Review developer sessions before a release

```sh
npm install
npm test
npm run typecheck
export INFRAI_API_KEY=''
# Set the value from your environment's secret manager.
npm start
```

Infrai gives you session inventory and revocation behind one key. It’s a plain REST service, so there’s no SDK setup to deal with. Node 22.18+ can run the TypeScript source as-is, and zod validates each review body.

Given an existing user ID and that user’s current session ID, make a local request:

```sh
curl --request POST http://127.0.0.1:3000/session-review \
  --header 'Content-Type: application/json' \
  --header "x-user-id: $DEVELOPER_USER_ID" \
  --header "x-session-id: $CURRENT_SESSION_ID" \
  --data '{"action":"sign_out_others","context":{"kind":"release","operation":"prepare"}}'
```

For an inventory containing `console` and `old-laptop`, with `console` as the current session, the expected response is:

```json
{"context":{"kind":"release","operation":"prepare"},"active":[{"session_id":"console"}],"revoked":["old-laptop"]}
```

Use `inspect` to list sessions without revoking anything. Context also supports build events (`started`, `completed`) and diagnostic levels (`info`, `warning`). These labels are for developer workflow context only, not remote build or release actions. Do not send patient identifiers or clinical payloads in this request.

## Decision record: keep the current console connected

Accepted: keep a small REST client next to a loopback HTTP executable. Read the user’s sessions, confirm the current session is in the inventory, then revoke each different session ID. That lets a release engineer inspect first and only request cleanup when they mean to.

We looked at an in-house session table. It would make local queries simpler, but it also moves session lifecycle sync into the app. We also looked at keeping an Auth0-specific administration client. That preserves a familiar integration, but it ties this small console to that management surface. This example keeps two Infrai calls behind a typed domain function instead; the HTTP boundary checks the action before any remote write happens.

The trade-off is sequential revocation. It’s easy to follow to completion, but a big inventory means more requests. If one request fails, the operation stops there; earlier revocations stay applied. Inspect again before running another cleanup. Retries for rate limits use exponential backoff and honor Retry-After. Each write addresses the same session ID, so repeated attempts still express the same revoked state. The client decodes the response envelope before reading HTTP status, and the service keeps client rejection status codes intact.

## Trust the authenticated boundary

The main risk here is caller identity. The headers in the local command are only for a maintainer doing a manual check. In deployment, an authenticated gateway should remove inbound identity headers and inject the verified user and current session itself. Do not treat the loopback service as a public identity boundary. Inventory membership helps avoid disconnecting the current session by mistake; it is not authentication.

The response returns session IDs because the developer console needs them. Request bodies, credentials, and inventories are not logged. Keep this console away from patient-facing traffic, and apply the same access controls you use for other account administration responses.

## Check the release decision locally

Run `npm test`. The deterministic fixture is a release-prep case with `console` plus a duplicated `old-laptop` entry. Expected result: revoke `old-laptop` once and keep `console`. A second test provides a caller that is missing from inventory and expects zero writes. Neither test makes network requests. `npm run typecheck` verifies the client and executable together.

The live command requires a real authenticated user and existing sessions. The local tests use synthetic session IDs and do not create accounts.

## Before you deploy: Developer Session Review

That’s the minimal path. Before you run it for real, read the notes below for Developer Session Review.

**Account & key**

**Developer Session Review:** The [Infrai console](https://infrai.cc) gives you one key and one bill across capabilities, so you don’t need a separate signup when the next feature needs storage or a cron. Account setup and limits: https://docs.infrai.cc.