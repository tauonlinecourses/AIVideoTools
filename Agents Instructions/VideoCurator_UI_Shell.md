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
- **Partial AI output handling**: if the model returns sections that don’t cover every sentence index, the client attempts to **repair** the output by filling missing index ranges into one or more “Unassigned” sections (instead of falling back to equal-sized chunks immediately).

### Store fields used in Phase 3 UI
- **Files**: `videoFile`
- **Transcript parse result**: `srtItems`, `isRTL`
- **Generation**: `sections`, `isGenerating`, `generateError`

### Store actions used in Phase 3 UI
- **Upload video**: `setVideoFile(file)`
- **Upload transcript**: `setSrtItems(items, isRTL)`
- **Generate**: `generateSections()`
- **Toggle**: `toggleSection(id)`

## Component map
### `UploadZone`
Path: `video-curator/src/components/UploadZone.tsx`

Responsibilities:
- Accepts `fileType: 'video' | 'transcript'`
- Supports drag/drop and click-to-upload
- Shows 3 visual states:
  - empty
  - drag-over
  - file loaded (shows filename)

Behavior:
- **Video upload**:
  - Accepts `.mp4`
  - Calls `useStore.getState().setVideoFile(file)` via `useStore` selector in component
- **Transcript upload**:
  - Accepts `.srt`
  - Reads file as text: `await file.text()`
  - Parses into `SrtItem[]` using `parseSrt(raw)` (`video-curator/src/lib/parseSrt.ts`)
  - Detects RTL using `detectDirection(items)` (`video-curator/src/lib/detectDirection.ts`)
  - Stores: `setSrtItems(items, isRTL)`

Imperative handle (for onboarding buttons):
- Exposes `openFileDialog()` via `ref`, implemented with `forwardRef` + `useImperativeHandle`

### `RightPanel`
Path: `video-curator/src/components/RightPanel.tsx`

Responsibilities:
- Renders one of three UI states (A/B/C) based on store values
- Provides two `UploadZone` rows (Video + Transcript) for click-to-upload and drag/drop
- Provides “Generate Sections” button wired to `generateSections()`
- Shows `SectionManager` after generation

#### RightPanel state machine
Derived from `useStore()`:
- **State A — Onboarding**:
  - Condition: `sections.length === 0` AND `(videoFile === null OR srtItems.length === 0)`
  - UI:
    - Title “Video Curator”
    - Steps 1–4 (static text)
    - Upload zones (video + transcript)
    - Generate button disabled
- **State B — Ready to generate**:
  - Condition: `sections.length === 0` AND `videoFile !== null` AND `srtItems.length > 0`
  - UI:
    - Same as State A
    - Generate button enabled
    - While `isGenerating === true`, the button shows a spinner and becomes disabled
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
- Row contents:
  - color swatch (from `section.color`)
  - section title
  - duration in `MM:SS`
  - enable/disable toggle calling `toggleSection(section.id)`
  - disabled sections are muted and struck through
- Bottom:
  - `Download Video` button (exports curated video)
  - `Download Transcript` button (exports curated transcript)

Export behavior:
- **Disable rules (both buttons)**:
  - Disabled when `store.sections.length === 0`
  - Disabled when all sections are toggled off (`section.isEnabled === false` for all sections)
  - Disabled while an export is in progress
  - Shows a muted helper label `No sections enabled` when sections exist but all are disabled
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
    - For each enabled section, derive `startTime` from the first item and `endTime` from the last item
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
  - start = `items[0].startTime`
  - end = `items[items.length - 1].endTime`
  - durationSeconds = `max(0, end - start)`
  - formatting: `MM:SS`
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
- Respect directionality:
  - Uses `dir="rtl"` when `store.isRTL === true`
  - Uses `dir="ltr"` when `store.isRTL === false`
  - This single flag controls alignment/flow of all transcript text inside the pane.
- Each sentence row shows:
  - Timestamp (`MM:SS`) using `SrtItem.startTime`
  - Sentence text (`SrtItem.text`)
- Section-aware styling:
  - Each row has a colored border matching its owning section color.
  - Ownership is derived by mapping `section.items[].index` → section metadata (memoized lookup).
  - If a sentence is not assigned to any section yet, border is neutral gray.
  - Disabled sections (`section.isEnabled === false`) render at ~40% opacity, but remain clickable.
- Active sentence highlight:
  - The sentence is considered active when `store.currentTime` falls between its `startTime` and `endTime`.
  - Active rows use a light background matching the section color at low opacity (~10%).
- Section label in margin:
  - Only for the **first sentence** of each section, display `{section.title}` and the section duration (`MM:SS`) in the margin on the border side:
    - LTR: label column on the left of the bordered content
    - RTL: label column on the right of the bordered content

Props:
- `onSeek(time: number)`: called when the user clicks a sentence row (uses the sentence `startTime`).

Imperative handle:
- Exposes `scrollToSentence(index: number)` via `forwardRef` + `useImperativeHandle`, so other UI (e.g. timeline) can scroll a sentence into view programmatically.

Boundary editing chevrons:
- On the **first sentence** of each section (except the very first section), a subtle hover-only `↑` button is shown that calls:
  - `store.moveSentenceUp(sectionId, 0)`
- On the **last sentence** of each section (except the very last section), a subtle hover-only `↓` button is shown that calls:
  - `store.moveSentenceDown(sectionId, lastIndex)`
- Chevrons are only visible when hovering the relevant sentence row (Tailwind `group-hover`).

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
  - `start = items[0].startTime`
  - `end = items[items.length - 1].endTime`
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
- If a block is wider than `80px`, its title is shown in-block (white, `11px`, truncated).
- If too narrow, the title is hidden and shown via a hover tooltip (HTML `title`) including title and duration.

Scrubber:
- A thin vertical line (`2px`, dark gray) indicates current playback position:
  - `pct = (currentTime / totalDuration) * 100`
- Updated via `requestAnimationFrame` by directly setting `scrubberRef.current.style.left = pct + '%'`.
- The rAF loop is started in `useEffect` and cancelled on unmount to avoid leaks.

Interactions:
- Clicking the timeline background seeks to the corresponding time:
  - `time = (clickX / containerWidth) * totalDuration`
- Clicking a section block:
  - Calls `onSectionClick(section.id)`
  - Also calls `onSeek(sectionStartTime)`

Empty state:
- When `sections.length === 0`, the timeline is still shown as a scrub-able bar driven by the uploaded video’s metadata:
  - Uses `store.videoDuration` for the time axis (so seeking works immediately after upload)
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

### App wiring for Phase 6
Path: `video-curator/src/App.tsx`

Rules:
- Components communicate only through `App.tsx` (no direct imports between player/timeline/transcript).

Refs:
- `videoPlayerRef` (`VideoPlayerHandle`) is used to call `seekTo`.
- `transcriptRef` (`TranscriptPaneHandle`) is used to call `scrollToSentence`.

Handlers:
- Shared seek:
  - `handleSeek(time)` calls `videoPlayerRef.current?.seekTo(time)`
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
- Implemented as an accessible checkbox switch:
  - A visually hidden `<input type="checkbox">` is the real control.
  - A styled `<label>` renders the switch track/thumb.
- Behavior:
  - Toggling calls `toggleSection(section.id)`
- Disabled visuals (`isEnabled === false`):
  - Title: muted + line-through
  - Color swatch: 40% opacity
  - Duration text: muted

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
- Shown only on hover of the relevant sentence row using `group` + `group-hover`.
- Up chevron (`↑`):
  - Only on the **first sentence** of a section, except for the first section overall.
  - Calls `moveSentenceUp(section.id, 0)` to move that sentence to the previous section.
  - Tooltip: “Move to previous section”
- Down chevron (`↓`):
  - Only on the **last sentence** of a section, except for the last section overall.
  - Calls `moveSentenceDown(section.id, lastItemIndex)` to move that sentence to the next section.
  - Tooltip: “Move to next section”
- Guard:
  - If a section has **≤ 1 sentence**, boundary chevrons are not shown for that section (moving the only sentence is not allowed).

### Disabled section visual consistency (Phase 4/5/7)
- `TranscriptPane`: sentences for disabled sections render at ~40% opacity, but remain clickable.
- `Timeline`: disabled section blocks render at ~40% opacity and include a diagonal stripe overlay.
- `SectionManager`: disabled rows are muted as described above.

