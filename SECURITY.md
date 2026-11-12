# Security

## Reporting a problem

Contact the maintainer privately through the email link on https://tristandolfo.netlify.app/, with "Omni-Reviewer demo security" in the subject. Please do not open a public issue for a vulnerability.

## What this demo is

A static export (Next.js `output: "export"`) served from Firebase Hosting. It ships fixed sample study packs, has no sign-in and no server code: every page is pre-rendered HTML plus browser JavaScript. Visitor progress is stored under an anonymous Firebase ID, and Firestore access is limited by `firestore.rules` and App Check.

## Dependency notes

`npm audit` was last reviewed on 2026-11-12. Every fix that does not downgrade a package has been applied. The advisories below remain; each row says where the affected code runs and why it stays. "Browser bundle" means the code ships to visitors; "build or CI tooling" means it runs only on a developer machine or in GitHub Actions.

| Advisory | Severity | Path | Where it runs | Why it remains |
| --- | --- | --- | --- | --- |
| [GHSA-m9gg-hp2v-232j](https://github.com/advisories/GHSA-m9gg-hp2v-232j), [GHSA-f596-whhp-79r4](https://github.com/advisories/GHSA-f596-whhp-79r4) | high, low | `firebase` → `@firebase/firestore` → `@grpc/grpc-js` 1.9.16 | Not shipped. `@grpc/grpc-js` is Firestore's Node.js transport; the browser build uses WebChannel. A search of the built `out/` for `@grpc/grpc-js` and gRPC-only strings finds nothing. | Both are server-side gRPC issues (certificate auth context, error messages from method handlers). The latest Firebase SDK (13.x) still pins `@grpc/grpc-js ~1.9.0`; npm's suggested fix is a downgrade to `firebase@9`, which is not taken. |
| [GHSA-238p-pmpm-9mq7](https://github.com/advisories/GHSA-238p-pmpm-9mq7) | low | `rehype-katex` / `remark-math` → `katex` 0.16.47 | Browser bundle (math rendering). | Exploiting it needs an existing prototype-pollution bug in the page plus untrusted math. The demo renders only its own sample packs, with KaTeX `trust: false`. `rehype-katex` 7.0.1 and `remark-math` 6.0.0 are the latest releases and require KaTeX 0.16; npm's fix is a downgrade. The app's own direct `katex` is 0.18.4 (fixed). |
| [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) | moderate | `firebase-tools`, `shadcn` (and their dependencies) → `minimatch` | Build or CI tooling. | Waiting for upstream releases; npm's fix for `firebase-tools` is a downgrade. |
| [GHSA-3g3m-2fjr-6pw4](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4) | moderate | `firebase-tools` → `glob` | Build or CI tooling (emulators for the rules tests). | Waiting for an upstream `firebase-tools` release. |
| [GHSA-8988-4f7v-96qf](https://github.com/advisories/GHSA-8988-4f7v-96qf) | moderate | `firebase-tools` → `@google-cloud/pubsub` → `@opentelemetry/core` | Build or CI tooling. | Waiting for an upstream `firebase-tools` release. |
| [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq) | moderate | `firebase-tools` → `gaxios` → `uuid` | Build or CI tooling. | Waiting for an upstream `firebase-tools` release. |
| [GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4) | low | `shadcn` → `deepmerge` | Build tooling (the shadcn CLI and its Tailwind CSS preset, compiled at build time). | No patched `deepmerge` release exists. |

Fixed in this review, for the record: `next` 16.3.4 → 16.4.6 clears its critical advisory. Those issues sit in server features (`next/og` image responses at request time, middleware, Draft Mode, `use cache`) that a static export never runs; `next/og` is used once at build time to render the static app icon. `zod` → 4.6.7, `re2js` → 2.10.0 and `undici` were updated. `shadcn` moved to `devDependencies` because it is a CLI and a build-time CSS import.

## Known limit

The Content-Security-Policy allows `'unsafe-inline'` scripts because a Next.js static export inlines its bootstrap scripts and there is no server to add per-request nonces.

