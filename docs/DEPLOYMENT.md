# Deployment

SAVE MY… is a single Bun/Hono service backed by PostgreSQL 17. The React app is
built into the same image and served by Hono, so production needs one public
container and one private database.

## Best route for the challenge: Render

Use the root \`render.yaml\` Blueprint. It provisions a Frankfurt Docker web
service and PostgreSQL database, injects the private connection string, runs the
idempotent migration before each release, and monitors \`/api/health\`.

1. Push the repository to GitHub.
2. Open \`https://render.com/deploy?repo=https://github.com/artem-musii/save-my\`.
3. Review the two resources and create the Blueprint.
4. Wait for both resources and the pre-deploy migration to become healthy.
5. Open the generated \`onrender.com\` URL in a signed-out browser.
6. Test anonymous demo isolation, judge login, secure cookies, response headers,
   and all 18 native Site Tools in the ChatGPT in-app browser.

The free tier is enough for judging, but it is a preview environment: the web
service sleeps after 15 minutes without traffic and can take about a minute to
wake; the free PostgreSQL database expires after 30 days. Those limits cover
the published judging period, but a paid instance is safer if first-impression
latency matters.

## Better long-term route: a VPS with Coolify

If you already have a server, this is the best control-to-cost option. A small
VPS with 2 GB RAM is a comfortable starting point for the app, database, proxy,
and build process.

1. Install Coolify and connect the public GitHub repository.
2. Deploy the repository as a Docker Compose application.
3. Keep PostgreSQL private; only the app should receive a public domain.
4. Set a strong database password and a release-specific judge password in the
   Coolify environment UI instead of committing them.
5. Map the app domain to container port 3000. Coolify’s proxy terminates HTTPS.
6. Back up the PostgreSQL volume before the judging period and before upgrades.

You do not need to buy a domain for the submission: a stable HTTPS platform
subdomain is accepted. Buy a domain if the project will live beyond the
challenge; point an A/AAAA record at the VPS and let Coolify issue TLS. A domain
improves trust and recall, but it does not make the deployment more reliable by
itself.

## Local production check

\`\`\`bash
docker compose up --build
\`\`\`

This builds the React assets, starts PostgreSQL, runs the migration, and serves
the app on \`http://localhost:3000\`. Demo templates are cloned lazily per tenant,
so there is no separate seed step.

## Required release verification

- \`GET /api/health\` returns 200 over HTTPS.
- \`Permissions-Policy: tools=(self)\` is present on the page response.
- Session cookies are \`HttpOnly\`, \`SameSite=Lax\`, and \`Secure\`.
- Anonymous demo state is isolated in two fresh browser sessions.
- Judge login creates isolated tenants and survives a reload.
- The database is unreachable from the public internet.
- The repository, live site, and video all use the same release commit.
- The live origin registers 18 tools and completes a native read call.
- The public links work while signed out and remain available through September 21.

The current release is intentionally single-instance. Database writes use
compare-and-swap, but horizontal scaling still needs centralized rate limiting.
