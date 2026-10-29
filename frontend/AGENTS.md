# Frontend development

This application uses React 19, TypeScript, Vite, Tailwind, and React Router. The former Next.js application was migrated; do not introduce Next.js imports, server components, or file-based routing assumptions.

Use `npm run build` and `npm run test` to verify changes. Keep cookie credentials and CSRF handling in `src/lib/api.ts`. Never store authentication tokens in browser storage. Laravel enforces permissions and business rules. Preserve existing workflows while consulting `../docs/MIGRATION.md` for remaining work and release gates.
