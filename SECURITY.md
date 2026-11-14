# Security

## Reporting a problem

Contact the maintainer privately through the email link on https://tristandolfo.netlify.app/, with "Omni-Reviewer demo security" in the subject. Please do not open a public issue for a vulnerability.

## What this demo is

A static export (Next.js `output: "export"`) served from Firebase Hosting. It ships fixed sample study packs, has no sign-in and no server code: every page is pre-rendered HTML plus browser JavaScript. Visitor progress is stored under an anonymous Firebase ID, and Firestore access is limited by `firestore.rules` and App Check.

## Dependency notes

`npm audit` was last reviewed on 2026-11-14. Every fix that does not downgrade a package has been applied. The advisories below remain, one row each, saying where the affected copy runs, how that was checked and why it stays. "Browser bundle" means the code ships to visitors; "development tooling" means it runs only on a developer machine or in GitHub Actions. A tooling row's proof is that `npm ls <package> --all --omit=dev` prints `(empty)`: the affected copy is not in the production dependency tree at all.

| Advisory | Severity | Affected copy and path | Where it runs | Proof (command → result) | Why it remains |
| --- | --- | --- | --- | --- | --- |
| [GHSA-m9gg-hp2v-232j](https://github.com/advisories/GHSA-m9gg-hp2v-232j) | high | `firebase` → `@firebase/firestore` → `@grpc/grpc-js` 1.9.16 (the `firebase-tools` copies are 1.14.6, not affected) | Not in the browser bundle: the browser build of Firestore uses WebChannel. Loaded in Node only by the Firestore rules tests (`tests/rules`, Vitest `node` environment) against the local emulator, on a developer machine and in CI. | `npm ls @grpc/grpc-js` → the path at left; `npm run build`, then `grep -rlE "grpc-js\|@grpc/\|ChannelCredentials" out` → no files (`grep -rl WebChannel out` → 1 file) | A gRPC server can report an unauthorized client certificate as authorized. Nothing here runs a gRPC server; the tests are a client of the local emulator. The latest Firebase SDK still pins `@grpc/grpc-js ~1.9.0`; npm's only fix is a downgrade to `firebase@9`. |
| [GHSA-f596-whhp-79r4](https://github.com/advisories/GHSA-f596-whhp-79r4) | low | same copy as the row above | Same as the row above. | Same as the row above. | A gRPC server can echo handler error messages to clients. Nothing here runs a gRPC server. Same pin and downgrade as above. |
| [GHSA-238p-pmpm-9mq7](https://github.com/advisories/GHSA-238p-pmpm-9mq7) | low | `rehype-katex` 7.0.1 → `katex` 0.16.47; `remark-math` 6.0.0 → `micromark-extension-math` → `katex` 0.16.47 | Browser bundle (math rendering). | `npm ls katex --omit=dev` → both 0.16.47 copies plus the app's own `katex` 0.18.4 (fixed); `components/study-markdown.tsx` passes KaTeX `trust: false` | Exploiting it needs an existing prototype-pollution bug in the page plus untrusted math; the demo renders only its own bundled sample packs. `rehype-katex` and `remark-math` are at their latest releases and require KaTeX 0.16; npm's fix is a downgrade. |
| [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) | moderate | `minimatch` 9.0.9 via `firebase-tools` → `glob` 10.5.0 (also through `archiver-utils`, `exegesis` and `rimraf`); `minimatch` 10.2.6 via `eslint-config-next` → `typescript-eslint` → `@typescript-eslint/typescript-estree`, and via `shadcn` → `ts-morph` → `@ts-morph/common` | Development tooling: the Firebase emulators, ESLint, and the shadcn CLI. | `npm ls minimatch --all --omit=dev` → `(empty)` | Waiting for upstream releases: the latest `typescript-eslint` and `ts-morph` still require `minimatch` 10, and npm's fix for `firebase-tools` is a downgrade. |
| [GHSA-3g3m-2fjr-6pw4](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4) | moderate | `firebase-tools` → `glob` 10.5.0 (also through `archiver-utils`, `exegesis` and `rimraf`) | Development tooling (the emulators for the rules tests). | `npm ls glob --all --omit=dev` → `(empty)` | Waiting for an upstream `firebase-tools` release; npm's fix is a downgrade. |
| [GHSA-8988-4f7v-96qf](https://github.com/advisories/GHSA-8988-4f7v-96qf) | moderate | `firebase-tools` → `@google-cloud/pubsub` → `@opentelemetry/core` 1.30.1 | Development tooling. | `npm ls @opentelemetry/core --all --omit=dev` → `(empty)` | Waiting for an upstream `firebase-tools` release. |
| [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq) | moderate | `firebase-tools` → `gaxios` → `uuid` 9.0.1 | Development tooling. | `npm ls uuid --all --omit=dev` → `(empty)` | Waiting for an upstream `firebase-tools` release. |
| [GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4) | low | `shadcn` → `@shadcn/registry` → `deepmerge` 4.3.1 | Development tooling (the shadcn CLI; its Tailwind CSS preset is compiled at build time). | `npm ls deepmerge --all --omit=dev` → `(empty)` | No patched `deepmerge` release exists. |

Fixed in this review, for the record: `hono` and `@hono/node-server` (through `firebase-tools`, 2026-11-14), and `next` 16.3.4 → 16.4.6, which clears its critical advisory. Those issues sit in server features (`next/og` image responses at request time, middleware, Draft Mode, `use cache`) that a static export never runs; `next/og` is used once at build time to render the static app icon. `zod` → 4.6.7, `re2js` → 2.10.0 and `undici` were updated. `shadcn` moved to `devDependencies` because it is a CLI and a build-time CSS import.

## Known limit

The Content-Security-Policy allows `'unsafe-inline'` scripts because a Next.js static export inlines its bootstrap scripts and there is no server to add per-request nonces.
