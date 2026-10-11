# Omni-Reviewer Demo

A public, no-sign-in demo of Omni-Reviewer's study workspace. Three sample packs
adapted from OpenStax *Microbiology* support Locked In, Summary, Test Me and
Carded, with a Today view and per-visitor progress.

## Try it

The demo is live at [omni-reviewer-demo.web.app](https://omni-reviewer-demo.web.app/).

For local development, use Node 24 (see `.nvmrc`):

```sh
npm ci
npm run dev
```

## What is real and what is replayed

Reading, citations, practice, card scheduling and progress persistence use the
ported study engine. The sample packs are recorded outputs of the original
generation pipeline, using openly licensed text in an isolated local environment.

Generate replays the recorded mode order and completion timings, capped at eight
seconds by the demo client. It is labelled **Recorded run**. Those timings are
derived from the job start and persisted view completion timestamps; they include
local orchestration time. Parallel modes can have a zero completion delta.

**In this demo, Ask plays back recorded answers.** Each pack offers two recorded
questions with cited answers. Free-text Ask is unavailable. The persistent header
label is **Demo · sample packs**.

Share of Locked In lines flagged as not from the source sections, measured from
the captured packs: Staining and microscopy 2.48%, Prokaryotic cell structure
4.07%, Antimicrobial drugs 17.7%. The antimicrobial pack's higher figure comes
mostly from drug-table side-effect and usage details that are not fully present
in the pasted text. The flags are shown in the packs rather than hidden.

## Data boundaries

No account creation, uploads or live AI calls. Firebase Auth assigns an anonymous
visitor ID in the background. Only schedules, attempts, session state and exam
dates are stored under that visitor's `demos/{uid}` paths in Firestore; the
sample pack content is served as static JSON. **Reset my progress** clears that
visitor's stored progress. Anonymous identity is tied to the browser's local
storage, so clearing browser data creates a new visitor identity.

The demo is intended for sample study content. It does not include private
lecture files, customer data or production database connections. Browser Firebase
configuration is public; access is controlled by Firestore rules and App Check.

## How it is built

Next.js 16 and React 19 produce a static export in `out/`, hosted on Firebase
Hosting. The existing Night/Day tokens, Tailwind 4 and Base UI primitives are
ported from the original app. The pure engine handles scheduling, practice,
citations and study planning.

Start with [`lib/demo/contract.ts`](lib/demo/contract.ts) for the shared client
interface and [`lib/demo/pack-schema.ts`](lib/demo/pack-schema.ts) for the validated
data boundary. The manifest is a JSON array of `PackSummary`; each pack follows
`DemoPack`. Capture and the pack loader use `demoPackSchema` and `manifestSchema`.
Original database identities are replaced with deterministic slugs. Required
view identity/date fields are empty strings, with revisions reset to one;
source content and citation numbering are retained.

Firebase uses anonymous Auth, Firestore in `asia-southeast1`, and reCAPTCHA
Enterprise App Check. The Hosting config caches packs for one hour and fingerprinted
assets for one year, and sets security headers. Inline scripts and styles are
allowed for the static Next.js output and existing component styles. The project
remains on Spark; no billing account is needed.

CI runs on pull requests and pushes to `main`, using Node 24 and Temurin Java 21
for the Firestore emulator:

```sh
npm run lint
npm run typecheck
npm run build
npm run check:public-safe
npm run check:bundle
npm run test:rules
```

`npm run check` runs the same sequence. The public-safety scan covers source,
config, sample data and the export when present. The bundle gate limits all
JavaScript under `out/_next/static` to 900 KiB gzip and reports the initial assets
referenced by each exported HTML route. The rules suite runs against the emulator,
not the hosted database.

## Capturing packs locally

Capture runs against a local instance of the original app, after generation and
two recorded Ask answers are complete. Its credentials must already be present
as `DEMO_USER_EMAIL` and `DEMO_USER_PASSWORD` environment variables. It signs in
itself through the local credentials callback; no session cookie needs copying.

```sh
node scripts/capture-pack.mjs --help
node scripts/capture-pack.mjs --base http://localhost:3100 --reviewer <id> --pack-id prokaryotic-cell
```

The base URL must be a localhost origin. Capture follows no network redirects,
stores cookies only in memory, and reads/writes repository files only. It validates
the completed run, source/citation mappings, original card content, and two cited
answers before writing `public/packs/<id>.json` and updating the manifest.
Email-like content, external URLs and prohibited identifiers fail capture.

Each approved section is one ready pasted-text source. The source API exposes a
whole-source response capped at 20,000 characters. Capture refuses unmarked text
at that limit, because the full source cannot be recovered from that response.
Sources with page markers are fetched one page at a time. Page 0 represents a
whole source or text before its first marker; it is not a printed book page.

## Provenance

UI primitives, global styling and the selected pure engine modules are ported
unchanged from [3StanTech/Omni-Reviewer at `0542c42`](https://github.com/3StanTech/Omni-Reviewer/tree/0542c42).
The demo contract, capture tool, Firebase client integration and static hosting
boundary are specific to this repository.

State verified on 2026-10-11: the demo is deployed from `main` to Firebase
Hosting, App Check is enforced on Firestore, and requests without an App Check
token are rejected. On a throttled Fast 3G phone profile the first study view is
usable in about 5.5 seconds; saved progress loads in the background.

## Licences

Code is all rights reserved; no code licence is granted. Third-party packages
retain their own licences.

Sample content adapted from OpenStax *Microbiology* (Rice University),
CC BY-NC-SA 4.0. Access for free at
[openstax.org](https://openstax.org/details/books/microbiology).
The sample pack licence and adaptation details are in
[`public/packs/LICENSE.md`](public/packs/LICENSE.md). Every study page is required
to display this attribution in its footer.
