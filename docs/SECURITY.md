# Security and privacy

## Data boundary

SAVE MY… accepts only operational continuity metadata. Never enter passwords, API/private keys, recovery codes, authentication tokens, card details, or other secret values. Demo data is fictional.

## Controls implemented

- Zod validation and fixed maximum array/string sizes at HTTP and WebMCP boundaries.
- 160 KB request limit enforced against both declared length and the streamed body.
- Argon2id password hashing through Bun.
- Opaque seven-day sessions in HttpOnly, SameSite=Lax cookies; `Secure` is enabled in production. Login rotates the session ID, and public judge logins receive isolated tenant IDs.
- PostgreSQL-backed sessions, tenant-scoped repository keys, and owner foreign keys.
- Atomic compare-and-swap workspace versions plus operation-scoped, payload-bound idempotency metadata committed inside the workspace aggregate.
- Human-only application authorization for proposal decisions.
- CSP-adjacent security headers through Hono: frame denial, no-referrer, origin isolation, and `Permissions-Policy: tools=(self)`.
- Public health endpoint contains no tenant data.
- No third-party analytics, OAuth, embedded model API, or credential integrations.

## Production checklist

- Use HTTPS at the reverse proxy and set `NODE_ENV=production`.
- Replace the documented test password through environment configuration before non-judge use.
- Restrict database networking to the application and backups.
- Add platform rate limiting and structured security logging.
- Run dependency audit and container scanning on the release commit.
- Confirm no `.env`, database dump, trace, screenshot, or test artifact is committed.

This is business-continuity planning software, not a credential vault, regulatory system, or aviation-safety system.
