# Project Structure

## Directory Tree

```text
AIVideoTools/
├── Agents Instructions/
│   └── VideoCurator_UI_Shell.md
├── STRUCTURE.md
├── vercel.json
└── video-curator/
    ├── .env.local
    ├── .gitignore
    ├── README.md
    ├── api/
    │   └── segment-transcript.ts
    ├── eslint.config.js
    ├── index.html
    ├── package-lock.json
    ├── package.json
    ├── postcss.config.js
    ├── public/
    │   ├── icons.svg
    │   └── icons/
    │       └── AI icon white.png
    ├── src/
    │   ├── App.tsx
    │   ├── components/
    │   │   ├── RightPanel.tsx
    │   │   ├── SectionManager.tsx
    │   │   ├── Timeline.tsx
    │   │   ├── TranscriptPane.tsx
    │   │   ├── UploadZone.tsx
    │   │   └── VideoPlayer.tsx
    │   ├── index.css
    │   ├── lib/
    │   │   ├── classNames.ts
    │   │   ├── detectDirection.ts
    │   │   ├── exportSrt.ts
    │   │   ├── exportVideo.ts
    │   │   ├── formatTime.ts
    │   │   ├── parseSrt.ts
    │   │   ├── sectionsTime.ts
    │   │   ├── segmentTranscript.ts
    │   │   └── store.ts
    │   ├── main.tsx
    │   └── types/
    │       └── transcript.ts
    ├── tailwind.config.js
    ├── tsconfig.app.json
    ├── tsconfig.json
    ├── tsconfig.node.json
    ├── vercel.json
    └── vite.config.ts
```

## File Purposes

- `Agents Instructions/VideoCurator_UI_Shell.md`: Documents the Video Curator UI shell, store contracts, phase flows, export behavior, and deployment notes.
- `STRUCTURE.md`: Documents the current repository structure, dependency usage, data flow, environment variables, and cleanup report.
- `vercel.json`: Root Vercel configuration that builds the nested `video-curator` app and sets SPA rewrites plus COOP/COEP headers.
- `video-curator/.env.local`: Local-only environment file for server-side segmentation credentials such as `OPENAI_API_KEY`.
- `video-curator/.gitignore`: Excludes dependencies, build output, local env files, and editor/runtime artifacts.
- `video-curator/README.md`: Vite template README with development and ESLint guidance.
- `video-curator/api/segment-transcript.ts`: Production serverless endpoint that proxies segmentation prompts to OpenAI without exposing API keys to the browser.
- `video-curator/eslint.config.js`: Flat ESLint configuration for TypeScript, React Hooks, React Refresh, and browser globals.
- `video-curator/index.html`: Vite HTML entry point containing the React root element.
- `video-curator/package-lock.json`: Locked npm dependency graph for reproducible installs.
- `video-curator/package.json`: App metadata, npm scripts, runtime dependencies, and development dependencies.
- `video-curator/postcss.config.js`: PostCSS configuration that enables Tailwind CSS and Autoprefixer.
- `video-curator/public/icons.svg`: Static SVG icon asset available from the public path.
- `video-curator/public/icons/AI icon white.png`: AI button icon used by `RightPanel`.
- `video-curator/src/App.tsx`: Top-level two-column app shell that wires seeking between player, timeline, transcript, and right panel.
- `video-curator/src/components/RightPanel.tsx`: Right sidebar that renders upload/generate states and the section manager after generation.
- `video-curator/src/components/SectionManager.tsx`: Section list UI for toggling, renaming, exporting video, and exporting transcript.
- `video-curator/src/components/Timeline.tsx`: Horizontal timeline that renders video/section duration, seeking, section blocks, and playhead position.
- `video-curator/src/components/TranscriptPane.tsx`: Scrollable transcript UI with active sentence tracking, section headers, toggles, and boundary editing controls.
- `video-curator/src/components/UploadZone.tsx`: Drag/drop and click upload control for video and SRT transcript files.
- `video-curator/src/components/VideoPlayer.tsx`: Native video preview, playback controls, metadata capture, seeking, and disabled-section playback skipping.
- `video-curator/src/index.css`: Tailwind CSS entry file.
- `video-curator/src/lib/classNames.ts`: Small helper for joining conditional class-name strings.
- `video-curator/src/lib/detectDirection.ts`: Detects whether parsed transcript text should render as RTL.
- `video-curator/src/lib/exportSrt.ts`: Builds a retimed SRT file from enabled sections.
- `video-curator/src/lib/exportVideo.ts`: Uses FFmpeg.wasm to trim enabled video ranges and concatenate them into an MP4.
- `video-curator/src/lib/formatTime.ts`: Shared `MM:SS` formatting helpers for rounded and floored time labels.
- `video-curator/src/lib/parseSrt.ts`: Parses SRT text into normalized transcript items with second-based timestamps.
- `video-curator/src/lib/sectionsTime.ts`: Computes section time ranges for playback skipping.
- `video-curator/src/lib/segmentTranscript.ts`: Builds AI prompts, calls the segmentation API, validates/repairs responses, and falls back to equal chunks.
- `video-curator/src/lib/store.ts`: Zustand store holding files, transcript data, sections, generation state, playback time, and section actions.
- `video-curator/src/main.tsx`: React entry point that mounts `App` into the Vite root element.
- `video-curator/src/types/transcript.ts`: Shared `SrtItem` and `Section` TypeScript interfaces.
- `video-curator/tailwind.config.js`: Tailwind content scanning and theme configuration.
- `video-curator/tsconfig.app.json`: Browser app TypeScript settings with unused locals/parameters enabled.
- `video-curator/tsconfig.json`: TypeScript project references for app and Vite config builds.
- `video-curator/tsconfig.node.json`: Node-side TypeScript settings for `vite.config.ts`.
- `video-curator/vercel.json`: Nested Vercel configuration for building the app from `video-curator/` and setting COOP/COEP headers.
- `video-curator/vite.config.ts`: Vite React config plus local dev middleware for `/api/segment-transcript`.

## Data Flow

1. `UploadZone` accepts an `.mp4` file and stores it through `useStore().setVideoFile`, which creates `videoUrl` for preview and resets video metadata.
2. `UploadZone` accepts an `.srt` file, reads text with `file.text()`, parses cues through `parseSrt`, detects text direction through `detectDirection`, and stores the result with `setSrtItems`.
3. `VideoPlayer` loads `videoUrl`, captures duration and a poster thumbnail through `setVideoMeta`, and publishes playback time through `setCurrentTime`.
4. `RightPanel` enables generation once both video and transcript exist, then calls `generateSections` from the Zustand store.
5. `generateSections` calls `segmentTranscript`, which posts a prompt to `/api/segment-transcript`; the Vite middleware or Vercel serverless function calls OpenAI server-side.
6. `segmentTranscript` validates and repairs the AI JSON response when possible, assigns section colors, and falls back to equal transcript chunks if the API or validation fails.
7. The store saves generated sections, and `Timeline`, `TranscriptPane`, `SectionManager`, and `VideoPlayer` subscribe only to the slices they need.
8. `TranscriptPane` and `Timeline` call back to `App` for seeks; `App` uses imperative refs to seek `VideoPlayer` and scroll `TranscriptPane`.
9. `SectionManager` toggles, renames, and adjusts sections through store actions.
10. `SectionManager` exports enabled sections through `exportSrt` for retimed captions and `exportVideo` for FFmpeg.wasm video trimming/concatenation.

## External Dependencies

### Runtime Dependencies

- `@ffmpeg/ffmpeg`: Provides the browser FFmpeg instance used by `exportVideo` to trim and concatenate MP4 sections.
- `@ffmpeg/util`: Provides FFmpeg helper utilities such as `fetchFile` and `toBlobURL` for loading inputs and the wasm core.
- `react`: Provides the React component and hook runtime.
- `react-dom`: Mounts the React app into the browser DOM.
- `srt-parser-2`: Parses uploaded SRT transcript text into cue objects.
- `zustand`: Holds the shared app state and actions used across the video, transcript, timeline, and export UI.

### Development Dependencies

- `@eslint/js`: Supplies ESLint recommended JavaScript rules.
- `@types/node`: Provides Node type definitions for Vite config and server-side request handling.
- `@types/react`: Provides React TypeScript definitions.
- `@types/react-dom`: Provides React DOM TypeScript definitions.
- `@vitejs/plugin-react`: Enables React support in Vite.
- `autoprefixer`: Adds browser vendor prefixes during PostCSS processing.
- `eslint`: Runs static lint checks.
- `eslint-plugin-react-hooks`: Enforces React Hooks rules and dependency checks.
- `eslint-plugin-react-refresh`: Enforces React Refresh compatible exports for Vite.
- `globals`: Supplies browser global definitions to ESLint.
- `postcss`: Runs CSS transforms for Tailwind and Autoprefixer.
- `tailwindcss`: Provides utility-first styling used throughout the UI.
- `typescript`: Type-checks the React app and Vite configuration.
- `typescript-eslint`: Connects TypeScript parsing and recommended rules to ESLint.
- `vite`: Runs the development server and production build.

## Environment Variables

- `OPENAI_API_KEY`: Preferred server-side OpenAI credential used by `video-curator/api/segment-transcript.ts` in production and `video-curator/vite.config.ts` during local development.
- `VITE_OPENAI_KEY`: Legacy local-development fallback read by the same server-side paths; it should not be used for production because `VITE_*` names are intended for client exposure.

## Cleanup Report

### Files Modified

- `Agents Instructions/VideoCurator_UI_Shell.md`: Added the shared type and utility module locations so the project instructions match the current source organization.
- `STRUCTURE.md`: Added project structure, file purposes, data flow, dependencies, environment variables, and this cleanup report.
- `video-curator/api/segment-transcript.ts`: Replaced explicit `any` types with Node request/response types, added response helpers, added type guards for request and OpenAI response shapes, and kept the same endpoint behavior.
- `video-curator/src/App.tsx`: Added an explicit component return type.
- `video-curator/src/components/RightPanel.tsx`: Added explicit component/helper return types.
- `video-curator/src/components/SectionManager.tsx`: Moved duplicated time/class helpers to shared modules, moved `DownloadIcon` out of render scope, added return types, and kept export/error behavior unchanged.
- `video-curator/src/components/Timeline.tsx`: Moved duplicated time helpers to `formatTime`, removed an avoidable type assertion, and added explicit return/event types.
- `video-curator/src/components/TranscriptPane.tsx`: Moved duplicated time/class helpers to shared modules, imported shared transcript types, and added an explicit component return type.
- `video-curator/src/components/UploadZone.tsx`: Imported shared `SrtItem` and `cx`, removed the local duplicated class helper, and added explicit helper/component return types.
- `video-curator/src/components/VideoPlayer.tsx`: Moved duplicated time formatting to `formatTime`, removed the React Hooks lint suppression by giving the rAF loop explicit effect dependencies, and added explicit helper/component return types.
- `video-curator/src/lib/classNames.ts`: Added shared conditional class-name joining helper.
- `video-curator/src/lib/detectDirection.ts`: Updated `SrtItem` import to the shared types module.
- `video-curator/src/lib/exportSrt.ts`: Updated `Section` import to the shared types module.
- `video-curator/src/lib/exportVideo.ts`: Updated `Section` import to the shared types module, replaced type assertions with runtime checks, and preserved FFmpeg export behavior.
- `video-curator/src/lib/formatTime.ts`: Added shared rounded/floored `MM:SS` formatting helpers.
- `video-curator/src/lib/parseSrt.ts`: Moved `SrtItem` definition to the shared types module.
- `video-curator/src/lib/sectionsTime.ts`: Updated `Section` import to the shared types module.
- `video-curator/src/lib/segmentTranscript.ts`: Updated shared type imports, removed `console.warn` debug/status output, and simplified an always-true dead-code branch without changing fallback behavior.
- `video-curator/src/lib/store.ts`: Moved shared model definitions to `src/types/transcript.ts`, re-exported them for compatibility, and added explicit return typing to store setup/local helpers.
- `video-curator/src/main.tsx`: Replaced the non-null root assertion with an explicit runtime guard.
- `video-curator/src/types/transcript.ts`: Added shared `SrtItem` and `Section` interfaces.
- `video-curator/vite.config.ts`: Replaced prompt/OpenAI response type assertions with small type guards in the local development API middleware.

### Files Deleted

- `video-curator/src/App.css`: Deleted unused Vite template stylesheet; it was not imported anywhere in the app.

### Unused Dependency Check

- Command run: `npx --yes depcheck --json`.
- Runtime dependencies: no unused runtime dependencies were reported.
- Reported dev-dependency candidates: `autoprefixer`, `postcss`, and `tailwindcss`.
- Decision: do not remove these automatically; they are part of the CSS pipeline via `postcss.config.js`, `tailwind.config.js`, and `src/index.css`, so the report is likely a depcheck false positive.
- Tool caveat: `depcheck` exited non-zero because it tried to parse commented TypeScript config files as strict JSON, but it still returned dependency usage data.

### Validation

- `npm run lint`: passed.
- `npm run build`: passed (`tsc -b && vite build`).
- IDE lints for edited source/config/docs: no linter errors reported.

### Remaining Human Decisions

- The production serverless endpoint and Vite dev middleware intentionally duplicate OpenAI proxy logic. Consolidating them would be a small architecture refactor, so it was left unchanged.
- `README.md` is still the default Vite template README. Replacing it with app-specific documentation would be useful, but it is documentation scope beyond cleanup.
- `public/icons.svg` is not referenced by current source code. It was kept because public assets may be referenced externally or reserved for future UI.

### Potential Bugs Not Auto-Fixed

- In `segmentTranscript.ts`, repaired Hebrew “Unassigned” runs may split more aggressively than English runs because the grouping check only recognizes the English `Unassigned` prefix. Fixing that changes AI repair output behavior, so it was flagged instead of changed.
