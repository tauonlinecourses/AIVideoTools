# Video Curator — Phase 3: Core UI Shell

This document describes the Phase 3 UI shell implementation for the Video Curator web app (React + TypeScript + Tailwind + Zustand).

## Design constraints (must hold)
- Light mode only
- System sans-serif
- Minimal UI, high contrast
- No gradients, no heavy shadows
- Tailwind utility classes only
- No rounded corners anywhere (do not use Tailwind `rounded*` utilities)
  - Exception: `Timeline` uses a subtle `rounded-[3px]` to match editing-software styling.
  - Exception: the 3 onboarding buttons (Upload Video, Upload Transcript, Generate Sections) use `rounded-[6px]`.
  - Exception: the transcript **File · YouTube** tab control and the YouTube **Import** button in `UploadZone` / `YouTubeInput` use `rounded-[6px]`.

## Source of truth: Zustand store
Store hook: `video-curator/src/lib/store.ts` exports `useStore()`.

## Environment setup (AI segmentation)
The transcript auto-segmentation feature calls **your own** `/api/segment-transcript` endpoint via `video-curator/src/lib/segmentTranscript.ts`, and that endpoint calls OpenAI **server-side**.

- **Server env var name**: `OPENAI_API_KEY`
- **Where it must live for local Vite dev**: `video-curator/.env.local` (Vite reads it in `vite.config.ts` using `loadEnv`, but it is never exposed to the client because it is not `VITE_*`)
- **Where it must live for Vercel deploy**: set `OPENAI_API_KEY` in Vercel project environment variables.
- **Legacy fallback (not recommended)**: `VITE_OPENAI_KEY` is accepted as a fallback for local/dev convenience, but avoid using it in production because `VITE_*` vars are designed to be client-exposed.
- **Symptom if missing**:
  - Local dev: `/api/segment-transcript` returns 500 “Missing OPENAI_API_KEY …”, the UI falls back to equal-sized chunks.
  - Deploy: same, until server env is configured.
- **Security note**: Do not ship OpenAI keys to the browser. Calling OpenAI directly from `http://localhost:5173` also fails with CORS; the `/api/...` approach avoids both CORS and key exposure.

## YouTube transcript import (server route)
Users can load captions from a public YouTube video **without uploading an `.srt` file** by pasting a watch URL (or an 11-character video id) and importing from the transcript upload control.

- **Client entry points**:
  - `video-curator/src/components/UploadZone.tsx` — when `fileType === 'transcript'`, a **File · YouTube** tab toggle chooses between the existing drag/drop `.srt` flow and the YouTube URL flow.
  - `video-curator/src/components/YouTubeInput.tsx` — URL field + language selector + **Import** button; on success calls `setSrtItems(items, isRTL)` the same way as file upload.
  - `video-curator/src/lib/fetchYoutubeTranscript.ts` — `POST /api/youtube-transcript` with `{ url, lang? }`, validates JSON, maps segments to `SrtItem[]` (sequential `index`).
- **Server implementation**:
  - `video-curator/server/youtubeTranscriptCore.ts` — uses `youtube-transcript` (`fetchTranscript`) for caption XML, normalizes timing (srv3 cues use **milliseconds** vs classic **seconds**; heuristic: mean cue duration `> 200` ⇒ treat as ms and divide by 1000), optional title via YouTube **oEmbed**.
  - `video-curator/api/youtube-transcript.ts` — Vercel serverless handler: `POST` body `{ url: string, lang?: string }` → `{ items: { startTime, endTime, text }[], title?, videoId }`. Returns **400** for transcript/URL errors, **429** for `YoutubeTranscriptTooManyRequestError`, **500** otherwise.
- **Local Vite dev**: `video-curator/vite.config.ts` mirrors `POST /api/youtube-transcript` the same way as `/api/segment-transcript` (no secrets required).
- **Env vars**: **None** for this route (unlike OpenAI). It still runs **server-side** so the browser is not blocked by YouTube/CORS.
- **Video file**: Importing from YouTube only fills **transcript state**. A local **`.mp4` upload is optional**—required only for playback preview and FFmpeg-based **video** export. Transcript-only generation/editing/export is supported.

## Build + deploy (Vercel)
- The Vercel build runs `npm run build`, which executes `tsc -b && vite build`.
- **Deploy layout** (recommended):
  - Set Vercel **Root Directory** to `video-curator/`
  - The static site output is `video-curator/dist`
  - Serverless functions live under `video-curator/api/`: `segment-transcript.ts` → `/api/segment-transcript`, `youtube-transcript.ts` → `/api/youtube-transcript`.
  - The folder `video-curator/` includes its own `vercel.json` with:
    - `buildCommand`: `npm ci && npm run build`
    - `outputDirectory`: `dist`
- TypeScript build settings are strict enough that **unused locals/parameters fail the build** (e.g. `TS6133`). Do not leave dead helpers or unused imports in committed code.
- **AI output invariants (must hold)**:
  - **Contiguous sections only**: every section is a single continuous index range \([start..end]\); no section may own disjoint indices.
  - **Ordered partition**: sections are back-to-back and cover indices `0..N-1` exactly once, in order.
  - The client validates these invariants on receipt.
- **Prompt hardening**: the client prompt explicitly requires contiguous ranges, a self-check (concatenation must equal `0..N-1`), and an escape hatch to return `{ "sections": [] }` if the model cannot comply.
- **Prompt format**: the model returns **range boundaries** (`startIndex`, `endIndex`, inclusive) per section (not per-sentence index lists) so the client can enforce contiguity by construction.
- **Section descriptions**: the model also returns a short 1–2 sentence `description` per section (same language as the transcript) to help editors quickly understand what’s discussed in each section.
- **Retry then fallback**: if validation fails, the client retries once with an even stricter addendum; if it still fails, it falls back to equal-sized chunks.
- **Partial AI output handling**: if the model returns sections that don’t cover every sentence index, the client attempts to **repair** the output by filling missing index ranges into one or more “Unassigned” sections (instead of falling back to equal-sized chunks immediately).
- **Section title language**: section titles are generated in the **same language as the transcript** (Hebrew transcripts → Hebrew titles; English transcripts → English titles). If the client has to repair missing indices, “Unassigned” section titles are also localized (Hebrew: “לא משויך”).

### Store fields used in Phase 3 UI
- **Files**: `videoFile`
- **Transcript parse result**: `srtItems`, `isRTL`
- **Generation**: `sections`, `isGenerating`, `generateProgress`, `generateError`
- **Selection**: `selectedRange` (sentence range), `selectedSectionId` (explicit section selection)

### Store actions used in Phase 3 UI
- **Upload video**: `setVideoFile(file)`
- **Upload transcript**: `setSrtItems(items, isRTL)`
- **Generate**: `generateSections()`
- **Toggle**: `toggleSection(id)`
- **Selection**:
  - Sentence checkbox range: `setSelectedIndex(index, checked)`
  - Section checkbox (in `TranscriptPane` section header): `setSelectedSectionId(id | null)`
  - Clear: `clearSelection()`

## Component map
### `UploadZone`
Path: `video-curator/src/components/UploadZone.tsx`

Responsibilities:
- Accepts `fileType: 'video' | 'transcript'`
- Supports drag/drop and click-to-upload (transcript also supports **YouTube URL import** via a tab)
- Shows 3 visual states:
  - empty
  - drag-over
  - file uploaded (high-contrast “Uploaded” styling + filename when available)

Behavior:
- **Video upload**:
  - Accepts `.mp4`
  - Calls `useStore.getState().setVideoFile(file)` via `useStore` selector in component
- **Transcript upload — File tab**:
  - Accepts `.srt`
  - Reads file as text: `await file.text()`
  - Parses into `SrtItem[]` using `parseSrt(raw)` (`video-curator/src/lib/parseSrt.ts`)
  - Detects RTL using `detectDirection(items)` (`video-curator/src/lib/detectDirection.ts`)
  - Stores: `setSrtItems(items, isRTL)`
  - UI: the upload card has a click-to-upload header area plus a small drag-and-drop box at the bottom (the drop box is also clickable to open the file picker).
- **Transcript upload — YouTube tab**:
  - Renders `YouTubeInput` instead of the file drop target
  - Tab control is a **File · YouTube** segmented control (`role="tablist"`), using `rounded-[6px]` per design exceptions
  - On successful import, the displayed label is `${title ?? 'YouTube transcript'} (${videoId})` (stored in local `transcriptFilename` state for the summary row when viewing the File tab / shared uploaded state)
  - Layout invariant: `UploadZone` reserves a fixed-height header row (`h-8`) above the upload card for **both** video and transcript, so the two upload cards stay vertically aligned when rendered side-by-side in `RightPanel`.
  - Height invariant: the YouTube import panel is wrapped in the same bordered card container and uses a shared minimum height so it visually matches the Video upload card.

Uploaded-state UI details:
- **When uploaded**:
  - Card uses `border-black` + `bg-gray-50`
  - Right-side status badge becomes black with a checkmark and label `Uploaded`
- **Hover affordance**:
  - When not uploaded, hover adds a subtle gray background (`hover:bg-gray-50`)
  - When uploaded, the `Uploaded` badge darkens slightly on hover (`group-hover:bg-gray-900`)
- **Transcript loaded detection**:
  - Transcript is considered uploaded when `store.srtItems.length > 0` (even if the filename is not known)
  - If filename is unknown, the card shows a fallback label `Transcript loaded`

Imperative handle (for onboarding buttons):
- Exposes `openFileDialog()` via `ref`, implemented with `forwardRef` + `useImperativeHandle`

### `YouTubeInput`
Path: `video-curator/src/components/YouTubeInput.tsx`

Responsibilities:
- Text input for a YouTube watch URL (or paste-friendly formats accepted by `youtube-transcript`)
- Language selection for the YouTube caption track:
  - **Select language** (default): omit `lang` and use YouTube’s default track
  - Quick picks: `he`, `en`, `ar`
- **Import** triggers `fetchYoutubeTranscriptAsSrtItems` (`video-curator/src/lib/fetchYoutubeTranscript.ts`)
- On success: `detectDirection` + `setSrtItems`, and `onImportedLabel` updates the parent upload summary string

Layout:
- URL input is a **full-width** row.
- Under it, a responsive row contains the language selector plus the **Import** button:
  - On narrow widths: two stacked rows (selector, then button).
  - On `sm+`: a two-column grid (`1fr` selector + `auto` button) so the controls never overlap in the narrow right panel.

### `RightPanel`
Path: `video-curator/src/components/RightPanel.tsx`

Responsibilities:
- Renders one of three UI states (A/B/C) based on store values
- Provides two `UploadZone` controls (Video + Transcript) for click-to-upload and drag/drop, displayed side-by-side
- Provides “Generate Sections” button wired to `generateSections()`
  - Includes the AI icon (`/public/icons/AI icon white.png`) on the left of the label
  - Button uses a fixed height (`h-11`) for a consistent, tappable target size
- Shows `SectionManager` after generation

#### RightPanel state machine
Derived from `useStore()`:
- **State A — Onboarding**:
  - Condition: `sections.length === 0` AND `srtItems.length === 0`
  - UI:
    - Title “Video Curator”
    - Steps 1–4 (static text)
    - Upload zones (video + transcript) displayed side-by-side
    - Generate button disabled
    - No footer disclaimer text (e.g. no “light mode only” line)
- **State B — Ready to generate**:
  - Condition: `sections.length === 0` AND `srtItems.length > 0` (video optional)
  - UI:
    - Same as State A
    - Generate button enabled
    - If `videoFile === null`, the user can still generate/edit/export the transcript; video preview and Download Video remain disabled until a video is uploaded.
    - While `isGenerating === true`:
      - The button shows a spinner and becomes disabled
      - A progress row appears below the button:
        - Label `Generating sections…`
        - Percentage from `generateProgress` (0–100)
        - A simple high-contrast progress bar (no rounded corners) that fills to ~90% while waiting for the API, then completes to 100% when results arrive
- **State C — Sections generated**:
  - Condition: `sections.length > 0`
  - UI:
    - Hides onboarding instructions
    - Shows `SectionManager`
    - If `generateError` is set, shows a yellow warning banner above the list

### `SectionManager`
Path: `video-curator/src/components/SectionManager.tsx`

Responsibilities:
- Lists `store.sections`
- Renders sections as a **vertical timeline**:
  - The sections list fills the available height.
  - Each section block height is proportional to its section duration (computed from transcript item times), so the full stack represents 100% of the total sections duration (like `Timeline` widths).
  - Each section block has a **minimum height** (`min-h-[56px]`) so the section title is always visible even for very short sections.
- Interaction:
  - Clicking a section **title** seeks the video to that section’s start time (same behavior as clicking a sentence row in `TranscriptPane`).
- Row contents:
  - a vertical colored spine line on the **right edge** (from `section.color`)
  - section title (right-aligned; double-click to rename per Phase 7)
  - section description (AI-generated 1–2 sentences) shown under the title
    - clamped to 2 lines and clipped (does not change section block height)
    - full text is available via hover tooltip
  - section duration (`MM:SS`)
  - enable/disable as an **eye icon** button calling `toggleSection(section.id)`
  - layout order (right → left): **Title, Duration, Eye**
  - Note: there is no section selection checkbox in `SectionManager`; explicit section selection (for destructive actions like remove) is performed from the `TranscriptPane` section header.
  - disabled sections are muted and struck through (title), and the spine is also muted
- Bottom:
  - `Download Video` button (exports curated video, with a left download icon)
  - `Download Transcript` button (exports curated transcript, with a left download icon)
  - `Download PDF` button (exports a full editing report as a PDF, with a left download icon)

Export behavior:
- **Disable rules (both buttons)**:
  - Disabled when `store.sections.length === 0`
  - Disabled when all sections are toggled off (`section.isEnabled === false` for all sections)
  - Disabled while an export is in progress
  - Shows a muted helper label `No sections enabled` when sections exist but all are disabled
- **Download PDF**:
  - **Async** export: button shows **Processing...** while `isExportingPdf` is true (brief raster pass; can take a few seconds on long transcripts)
  - **Raster-based** PDF via `html2canvas` + jsPDF image pagination so Hebrew/RTL text renders with browser shaping (not jsPDF built-in fonts)
  - **Colorful report** layout mirrors transcript UI semantics:
    - Per-section **colored spine** (`section.color`) on the transcript edge
    - Light row tint from section color (~10% alpha); hidden rows use gray background
    - Section headers show title, **LTR** time range column, and `ENABLED` / `DISABLED` badge
    - Per-sentence **LTR** timestamp column; transcript text uses `rtl` when Hebrew
    - Disabled sections at ~40% opacity; hidden sentences with `HIDDEN` label, strikethrough, and reduced opacity
  - Includes **all sections** in order, even disabled sections
  - Includes **all sentences** in each section with per-sentence timestamps
  - Includes hidden sentences (`store.hiddenSentenceByIndex[index] === true`) but marks them as `HIDDEN`
  - Includes section descriptions when present
  - Header-only summary (title, generated time, counts); no separate video description block
  - Implementation: `video-curator/src/lib/exportPdf.ts` (direct `html2canvas` dependency)
  - Disable rules:
    - Disabled when `store.sections.length === 0`
    - Disabled while a video export is in progress, or while PDF export is in progress
- **Download Transcript**:
  - Synchronous export (no loading UI)
  - Only enabled sections are included
  - Implementation: `video-curator/src/lib/exportSrt.ts`
  - Re-timing rules:
    - Cues are collected in the current UI order from enabled sections
    - Cues are re-numbered starting at 1
    - Each cue keeps its original duration \(endTime - startTime\)
    - New timing is packed contiguously:
      - `newStart` = previous cue `newEnd`
      - `newEnd` = `newStart + duration`
    - Timestamps are formatted as SRT `HH:MM:SS,mmm`
- **Download Video**:
  - Uses **ffmpeg.wasm** and is **lazy-loaded** on first export click (never on app startup)
  - Implementation: `video-curator/src/lib/exportVideo.ts`
  - Pipeline:
    - For each enabled section, derive `startTime`/`endTime` from transcript cue times:
      - Default: `startTime = firstItem.startTime`, `endTime = lastItem.endTime`
      - **Intro/outro padding** (prevents cutting silent parts that have no transcript cues):
        - If the **first section overall** is enabled, its `startTime` is clamped to `0`
        - If the **last section overall** is enabled and `store.videoDuration` is known/positive, its `endTime` is clamped to `videoDuration`
        - If `videoDuration` is unknown, the outro falls back to the last subtitle `endTime` (no padding)
    - Create `segment_i.mp4` files by **re-encoding** (H.264/AAC) to guarantee clean cuts that start with a decodable video frame
      - Rationale: stream copy can start on a non-keyframe → audio starts immediately but video may stay black until the next keyframe
    - Concatenate segments using the concat demuxer (`concat.txt` → `output.mp4`)
  - Progress:
    - Displays a simple progress bar with label `Processing... {n}%`
    - Progress is clamped to 0–100 for UI safety
  - Errors:
    - On failure, a red error panel is shown and export can be retried
  - Cleanup:
    - Best-effort deletes ffmpeg virtual filesystem artifacts: `input.mp4`, `output.mp4`, `concat.txt`, and all `segment_i.mp4` files

Duration calculation:
- For section items \(SrtItem[]\):
  - start = `min(items[].startTime)`
  - end = `max(items[].endTime)`
  - durationSeconds = `max(0, end - start)`
  - formatting: `MM:SS` (floored, not rounded)
- If `items` is empty: `00:00`

## App shell layout
Path: `video-curator/src/App.tsx`

Rules:
- Two-column layout, no page scroll:
  - wrapper: `h-screen overflow-hidden`
  - left: `w-[65%]` workspace stack:
    - Video player placeholder (top)
    - `Timeline` (middle)
    - `TranscriptPane` (bottom, scrollable)
  - right: `w-[35%]` renders `RightPanel`
- Background: white

## Phase 4: Transcript Pane

### `TranscriptPane`
Path: `video-curator/src/components/TranscriptPane.tsx`

Responsibilities:
- Render the full transcript (`store.srtItems`) as a vertically scrollable pane with a fixed header.
- Visual styling:
  - The transcript pane is **borderless** (no outer container border).
  - The transcript header selection panel (under the “Transcript” title) uses **only a bottom border** (no top/left/right border).
  - Sentence rows do not use horizontal divider lines between them (spacing is used instead).
- Respect directionality:
  - Uses `dir="rtl"` when `store.isRTL === true`
  - Uses `dir="ltr"` when `store.isRTL === false`
  - This single flag controls alignment/flow of all transcript text inside the pane.
- Per-sentence text direction:
  - Sentence text is additionally rendered with per-row direction detection.
  - If the sentence contains Hebrew characters, the sentence text is `dir="rtl"` and right-aligned.
  - Otherwise, the sentence text is `dir="ltr"` and left-aligned.
- Each sentence row shows:
  - Timestamp (`MM:SS`) using `SrtItem.startTime`
  - Sentence text (`SrtItem.text`)
  - A sentence **selection checkbox** (used by the Transcript header selection panel)
- Hover affordance:
  - On hover, sentence rows get a subtle light-gray background to indicate click-to-seek.
  - Active-row highlighting takes precedence over hover.
- Sentence selection visuals:
  - Selected sentences render with a subtle high-contrast background tint.
  - Active (playback) highlight still applies; if a sentence is both active + selected, the highlight is slightly stronger.
- Section-aware styling:
  - Each row has a vertical colored spine matching its owning section color.
    - The spine is a real element (not a CSS border) so it can be thicker and have rounded corners (`rounded-[6px]`, like the upload buttons).
    - The spine sits on the **outer edge of the full row** (it wraps both timestamp + text), so no row content renders “past” the spine on either side (LTR/RTL).
    - Rounding rules:
      - The spine begins on the **section header row** (title row) for each section.
      - Only the **top** of the section header spine is rounded.
      - Only the **bottom** of the last sentence in a section is rounded.
      - Single-sentence sections are rounded on both ends.
  - Ownership is derived by mapping `section.items[].index` → section metadata (memoized lookup).
  - If a sentence is not assigned to any section yet, border is neutral gray.
  - Disabled sections (`section.isEnabled === false`) render at ~40% opacity, but remain clickable.
  - Per-sentence hiding (strike-through) is independent of section enable/disable and must not make the section header look “disabled”.
  - The border column stretches to the full row height (including when the section label makes the first row taller), so the vertical spine does not “break” on the first sentence.
  - Vertical spacing rules:
    - Consecutive sentences that belong to the same section have **no vertical gap** between rows, so the colored border reads as a continuous vertical spine.
    - When the section changes between adjacent sentences, a slightly larger vertical gap is shown between the rows to clearly separate sections.
- Active sentence highlight:
  - The sentence is considered active when `store.currentTime` falls between its `startTime` and `endTime`.
  - Active rows use a light background matching the section color at low opacity (~10%).
- Transcript header selection panel (under the “Transcript” title):
  - Shows `Selected: N` (count of sentences in the current selection).
  - Provides bulk actions for the current selection:
    - `Move prev` / `Move next`: move the selected sentences to the adjacent section.
    - `Create section`: split the current section and create a new section containing the selected range.
    - `Remove section`: remove the explicitly selected section (merges into a neighbor). Sentence selection alone is not enough.
    - `Clear`: clear the current selection.
  - Selection rule (by design):
    - Selection is a **single contiguous index range** (not arbitrary multi-select) to preserve the core invariants that sections are an ordered contiguous partition of indices.
    - If selection spans multiple sections, bulk actions are disabled until the selection is constrained to a single section.
 - New section color rule (manual creation):
   - When `Create section` inserts a new section, its `section.color` is chosen from the fixed palette such that it does **not** match the immediate neighbor section colors (previous and next in the `sections` array) at the insertion point.
- Section header (title row):
  - When a new section starts (i.e., the current sentence is the first sentence of a section), a **section header row** is inserted **above** that section’s first sentence.
  - The header shows:
    - a section **selection checkbox** (used for destructive actions like removing a section)
    - an eye icon toggle button (enable/disable the section) to the left of the section duration
    - section duration (`MM:SS`) on the left
    - `{section.title}` (truncated if needed) on the right
  - Layout note:
    - Duration and title are rendered adjacent (not spread to opposite edges), with the title in a slightly larger font.
  - The prior “name/margin column” layout is not used; sentence rows are a 2-column layout (timestamp + text) for both LTR and RTL.

Props:
- `onSeek(time: number)`: called when the user clicks a sentence row (uses the sentence `startTime`).

Imperative handle:
- Exposes `scrollToSentence(index: number)` via `forwardRef` + `useImperativeHandle`, so other UI (e.g. timeline) can scroll a sentence into view programmatically.

Boundary editing:
- Section boundary adjustments are performed via the Transcript header selection panel actions (bulk move prev/next), rather than per-sentence chevrons.

Auto-scroll during playback:
- When `store.currentTime` changes and causes the **active sentence index** to change, the pane scrolls the active sentence into view smoothly.
- Manual user scrolling is respected:
  - On scroll events, `isUserScrolling` is set and auto-scroll is suppressed.
  - After 2 seconds without scroll events, auto-scroll is re-enabled.

## Phase 5: Horizontal Timeline

### `Timeline`
Path: `video-curator/src/components/Timeline.tsx`

Responsibilities:
- Render a **single horizontal time axis** (time always flows left → right; this is not an RTL-aware text element).
- Display one colored block per `store.sections` with width proportional to its duration.
- Display a scrubber line for playback position.
- Provide click interactions to seek and jump/scroll to a section.

Store fields used:
- `sections`
- `currentTime` (read inside an rAF loop via `useStore.getState()` to avoid rerendering every frame)

Props:
- `onSeek(time: number)`: called when clicking the timeline background or when clicking a section block (seeks to that section’s start).
- `onSectionClick(sectionId: number)`: called when clicking a section block (used by `App.tsx` to scroll the transcript to the section’s first sentence).

Layout:
- A single bar, full width of the left column, fixed height `48px` (`h-12`), sitting between the video placeholder and transcript pane.

Section blocks:
- Section duration is computed from section transcript items:
  - `start = min(items[].startTime)` (except the **first section**, which uses `0` to include intro padding)
  - `end = max(items[].endTime)` (except the **last section**, which uses `store.videoDuration` when known/positive to include outro padding)
  - `durationSeconds = max(0, end - start)`
- Total duration:
  - `totalDuration = sum(sectionDurationSeconds)`
- Width:
  - `width% = sectionDuration / totalDuration * 100`
- Visuals:
  - Background color uses `section.color`.
  - Blocks are separated by a `1px` white gap (`gap-[1px]`).
  - Disabled sections (`isEnabled === false`) render at ~40% opacity and include a diagonal stripe overlay using:

```text
repeating-linear-gradient(
  45deg,
  rgba(0,0,0,0.15) 0px,
  rgba(0,0,0,0.15) 4px,
  transparent 4px,
  transparent 10px
)
```

Titles / tooltips:
- If a block is wider than `80px`, its title is shown in-block (white, `11px`, truncated, **right-aligned within the block**).
  - Truncation shows the ellipsis on the **left** side (so the end of the title stays closest to the right edge).
- If too narrow, the title is hidden and shown via a hover tooltip (HTML `title`) including title and duration.
 - The last section block keeps the same proportional width as the others, but its **title text** gets a bit of extra right padding so it doesn’t visually touch the timeline edge.

Scrubber:
- A high-contrast playhead indicates current playback position:
  - A vertical line (`3px`, black)
  - A small upside-down (down-pointing) black triangle marker rendered **above the timeline bar**, aligned to the line
  - `pct = (currentTime / totalDuration) * 100`
- Updated via `requestAnimationFrame` by directly setting a **center-positioned playhead wrapper** `style.left = pct + '%'` (the line + triangle are centered on that point).
- The rAF loop is started in `useEffect` and cancelled on unmount to avoid leaks.

Interactions:
- Clicking the timeline background seeks to the corresponding time:
  - `time = (clickX / containerWidth) * totalDuration`
- Clicking a section block:
  - Calls `onSectionClick(section.id)`
  - Also calls `onSeek(timeWithinSection)` based on the click position inside the block:
    - `timeWithinSection = sectionStartTime + (localClickX / blockWidth) * (sectionEndTime - sectionStartTime)`

Empty state:
- When `sections.length === 0`, the timeline is still shown as a scrub-able bar driven by duration metadata:
  - If a video is uploaded: uses `store.videoDuration` for the time axis (so seeking works immediately after upload)
  - If no video is uploaded (transcript-only): uses the transcript duration derived from the last subtitle `endTime`
  - Shows a “filmstrip” background by repeating a captured still (`store.timelinePosterUrl`) across the full width (editing-software style)
  - Falls back to a plain light background until the first frame is captured

## Phase 6: Video Player + Sync Loop

### `VideoPlayer`
Path: `video-curator/src/components/VideoPlayer.tsx`

Responsibilities:
- Render a native HTML `<video>` element (no third-party player library).
- Maintain a 16:9 preview area that fills the available width (within the player max width).
- When `store.videoUrl` is `null`, show a gray placeholder instead of the `<video>` element.
- Provide minimal custom controls (do **not** use the browser’s default `controls` attribute):
  - Play/Pause toggle button (inline SVG icons, icon-only)
  - Time display text: `MM:SS / MM:SS`
UI details:
- The video preview uses a fill strategy (cropping if needed) to avoid letterboxing/pillarboxing.
- Controls layout: play/pause is centered under the video, while the time display is aligned to the right on the same row.
- The video preview surface supports click-to-toggle play/pause (same behavior as the Play/Pause button).

Store fields used:
- `videoUrl`
- `setCurrentTime(t)`

Implementation note:
- The `<video>` element is only rendered when `store.videoUrl` is set; event listeners (play/pause/ended/metadata) must be attached when the element mounts/changes so the play button icon stays in sync.

#### Video source behavior
- The `<video>` element’s `src` is driven by `store.videoUrl` inside a `useEffect`:
  - When `videoUrl` changes to a non-null value: set `video.src = videoUrl` and call `video.load()`.
  - When `videoUrl` becomes null: remove `src`, call `load()`, and reset local UI state (duration, play state, time label).

#### Sync loop (critical)
Goal: allow `Timeline` and `TranscriptPane` to react to playback without re-rendering `VideoPlayer` at 60fps.

- `VideoPlayer` runs a `requestAnimationFrame` loop started on mount and cancelled on unmount.
- Each tick reads `video.currentTime` and stores it in a ref (`currentTimeRef`).
- Zustand is only updated when playback time changes “meaningfully”:
  - Threshold: `> 0.1` seconds (100ms)
  - This prevents high-frequency updates that would cause excessive subscriber rerenders.

#### Imperative seeking
`VideoPlayer` exposes an imperative handle:
- `seekTo(time: number)` sets:
  - `video.currentTime = time`
  - internal refs (`currentTimeRef`, last synced time)
  - `store.setCurrentTime(time)` immediately

#### Skip disabled sections during playback
When `store.sections.length > 0`, the player will **skip disabled sections** (`section.isEnabled === false`) while the video is **actively playing**:
- **Playback-only**: skipping is enforced only when `video.paused === false` (normal playback progression).
- **Manual seek exception**: when the user seeks programmatically (timeline click / transcript click via `seekTo(...)`), skip enforcement is temporarily suppressed for a short window so the user can land inside disabled sections if desired.
- **All sections disabled**: if no sections are enabled, the player behaves like a normal video player and does **not** skip (plays the full original).
- **Skip target**: when playback enters a disabled section, the player seeks to the next enabled section’s start time.
- **End case**: if playback enters a disabled section and there is no enabled section after it, the player seeks to that disabled section’s end time and pauses.

### App wiring for Phase 6
Path: `video-curator/src/App.tsx`

Rules:
- Components communicate only through `App.tsx` (no direct imports between player/timeline/transcript).

Refs:
- `videoPlayerRef` (`VideoPlayerHandle`) is used to call `seekTo`.
- `transcriptRef` (`TranscriptPaneHandle`) is used to call `scrollToSentence`.

Handlers:
- Shared seek:
  - `handleSeek(time)` seeks the video when available; otherwise it sets `store.currentTime` (transcript-only mode) so the playhead + active sentence highlighting still work.
  - Passed to:
    - `Timeline.onSeek`
    - `TranscriptPane.onSeek`
- Section click (from timeline):
  - Find section by id from `store.sections`
  - If it has items:
    - `transcriptRef.current?.scrollToSentence(firstItem.index)`
    - `videoPlayerRef.current?.seekTo(firstItem.startTime)`

Left column layout (top → bottom, no page scroll):
- `<VideoPlayer ref={videoPlayerRef} />`
- `<Timeline onSeek={handleSeek} onSectionClick={handleSectionClick} />`
- `<TranscriptPane ref={transcriptRef} onSeek={handleSeek} />` (fills remaining height, scrollable)

## Phase 7: Section Editing

Phase 7 wires up the section editing interactions across `TranscriptPane` and `SectionManager` by updating `store.sections` in Zustand. Because all surfaces read the same `sections` array, changes propagate automatically.

### Store action added in Phase 7
- **Rename**: `renameSection(id, title)`
  - Implementation updates `sections` immutably by mapping the matching section id and replacing `title`.

### `SectionManager` — enable/disable + rename
Path: `video-curator/src/components/SectionManager.tsx`

Enable/disable toggle:
- Implemented as an icon-only **eye button** (open/closed eye) to match `TranscriptPane` section headers.
- Behavior:
  - Toggling calls `toggleSection(section.id)`
- Disabled visuals (`isEnabled === false`):
  - Title: muted + line-through
  - Right-edge color spine: ~40% opacity
  - Duration label: muted

Inline title editing:
- Default: title renders as plain text.
- Enter edit mode: double-click the title (keyboard: Enter/Space on the title).
- Save:
  - On blur or Enter, saves via `renameSection(section.id, trimmedTitle)`.
  - Empty/whitespace-only titles are not saved (reverts to original).
- Cancel:
  - Escape cancels editing and reverts to the original title.

### `TranscriptPane` — boundary editing chevrons
Path: `video-curator/src/components/TranscriptPane.tsx`

Boundary editing buttons:
- Shown **always** (not hover-only).
- Placement:
  - Rendered inside the timestamp cell of the sentence row, adjacent to the timestamp.
- Up chevron (`↑`):
  - Only on the **first sentence** of a section, except for the first section overall.
  - Calls `moveSentenceUp(section.id, 0)` to move that sentence to the previous section.
  - Tooltip: “Move to previous section”
- Down chevron (`↓`):
  - Only on the **last sentence** of a section, except for the last section overall.
  - Calls `moveSentenceDown(section.id, lastItemIndex)` to move that sentence to the next section.
  - Tooltip: “Move to next section”
- Visual affordance:
  - Borderless, transparent buttons (no background) with a larger tap/click target and bold, high-contrast arrow glyphs.
  - On hover, the arrow glyph scales up slightly (for extra discoverability).
- Guard:
  - If a section has **≤ 1 sentence**, boundary chevrons are not shown for that section (moving the only sentence is not allowed).

### Disabled section visual consistency (Phase 4/5/7)
- `TranscriptPane`: sentences for disabled sections render at ~40% opacity, but remain clickable.
- `Timeline`: disabled section blocks render at ~40% opacity and include a diagonal stripe overlay.
- `SectionManager`: disabled rows are muted as described above.

