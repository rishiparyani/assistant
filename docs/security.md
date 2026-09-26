# Security

- HTTPS via Cloudflare.
- Better Auth sessions in HttpOnly, Secure, SameSite cookies; origin checks on state-changing requests.
- No password login (hashing can exceed the 10 ms CPU limit): Google, passkeys, email magic links.
- One authorization middleware for every route and MCP tool: user → membership → role → module enabled → token scope.
- Zod validation on every input. Drizzle parameterised queries only; no raw SQL from clients or AI.
- Secrets as Worker secrets; never in the repo. `.dev.vars` is git-ignored.
- API tokens stored hashed, scoped per module/operation, revocable, `last_used_at` tracked.
- Cloudflare rate limiting on `/auth/*` and `/api/*`.
- Audit log for every write.
- Two-step confirmation for money, cancellations and deletes from MCP.
- Text from data (notes, names, anything user- or client-entered) is untrusted in MCP responses: return it as data, never as instructions; keep it clearly delimited.
- New modules inherit all of the above through the operation wrapper; a module never registers its own unauthenticated route without a recorded decision.
- Keep dependencies (especially Better Auth) updated.
- `shortcuts/` never contains tokens.
