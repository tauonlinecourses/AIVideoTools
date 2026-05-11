import { create } from 'zustand'
import type { SrtItem } from './parseSrt'
import { segmentTranscript } from './segmentTranscript'

export interface Section {
  id: number
  title: string
  description: string
  color: string
  isEnabled: boolean
  items: SrtItem[]
}

export type SelectedRange = { start: number; end: number }

export interface AppState {
  // Files
  videoFile: File | null
  videoUrl: string | null
  rawSrt: string | null

  // Video metadata (drives timeline before sections exist)
  videoDuration: number
  timelinePosterUrl: string | null

  // Parsed data
  srtItems: SrtItem[]
  isRTL: boolean

  // Sections
  sections: Section[]
  isGenerating: boolean
  generateProgress: number // 0..100 (UI only; simulated while waiting for API)
  generateError: string | null

  // Transcript selection (contiguous range only)
  selectedRange: SelectedRange | null

  // Per-sentence visibility (independent of section enable/disable)
  hiddenSentenceByIndex: Record<number, true>

  // Selected section (explicit section-level selection)
  selectedSectionId: number | null

  // Playback
  currentTime: number

  // Actions
  setVideoFile: (file: File) => void
  setVideoMeta: (meta: { duration: number; timelinePosterUrl: string | null }) => void
  setSrtItems: (items: SrtItem[], isRTL: boolean) => void
  setSections: (sections: Section[]) => void
  setSelectedIndex: (index: number, checked: boolean) => void
  setSelectedSectionId: (id: number | null) => void
  clearSelection: () => void
  hideSelectedSentences: () => void
  unhideSelectedSentences: () => void
  setIsGenerating: (val: boolean) => void
  setGenerateProgress: (val: number) => void
  setGenerateError: (err: string | null) => void
  setCurrentTime: (t: number) => void
  toggleSection: (id: number) => void
  renameSection: (id: number, title: string) => void
  moveSentenceUp: (sectionId: number, itemIndex: number) => void
  moveSentenceDown: (sectionId: number, itemIndex: number) => void
  moveSelectionToPrevSection: () => void
  moveSelectionToNextSection: () => void
  createSectionFromSelection: () => void
  removeSelectedSection: () => void
  generateSections: () => Promise<void>

}

const SECTION_COLORS = [
  '#EF4444', // red
  '#3B82F6', // blue
  '#F59E0B', // amber
  '#10B981', // green
  '#8B5CF6', // purple
  '#EC4899', // pink
  '#06B6D4', // cyan
  '#F97316', // orange
]

function pickSectionColorAvoidingNeighbors(args: {
  prevColor: string | null
  nextColor: string | null
}): string {
  const forbidden = new Set<string>()
  if (args.prevColor) forbidden.add(args.prevColor)
  if (args.nextColor) forbidden.add(args.nextColor)

  for (const c of SECTION_COLORS) {
    if (!forbidden.has(c)) return c
  }

  // Palette exhausted (or both neighbors use all colors somehow). Fall back deterministically.
  if (args.prevColor && SECTION_COLORS[0] === args.prevColor && SECTION_COLORS.length > 1) return SECTION_COLORS[1]
  return SECTION_COLORS[0]
}

function normalizeItems(items: SrtItem[]): SrtItem[] {
  return [...items].sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
}

function findSectionIndexForSentenceIndex(sections: Section[], sentenceIndex: number): number {
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i]
    for (let j = 0; j < s.items.length; j++) {
      if (s.items[j]?.index === sentenceIndex) return i
    }
  }
  return -1
}

function rangeWithinSingleSection(sections: Section[], range: SelectedRange): { sectionIndex: number; sectionId: number } | null {
  const a = findSectionIndexForSentenceIndex(sections, range.start)
  if (a < 0) return null
  const b = findSectionIndexForSentenceIndex(sections, range.end)
  if (b !== a) return null
  return { sectionIndex: a, sectionId: sections[a].id }
}

function nextSectionId(sections: Section[]): number {
  let maxId = 0
  for (const s of sections) maxId = Math.max(maxId, s.id)
  return maxId + 1
}

export const useStore = create<AppState>((set) => ({
  // Initial state
  videoFile: null,
  videoUrl: null,
  rawSrt: null,
  videoDuration: 0,
  timelinePosterUrl: null,
  srtItems: [],
  isRTL: false,
  sections: [],
  isGenerating: false,
  generateProgress: 0,
  generateError: null,
  selectedRange: null,
  hiddenSentenceByIndex: {},
  selectedSectionId: null,
  currentTime: 0,

  // Actions
  setVideoFile: (file) => set({
    videoFile: file,
    videoUrl: URL.createObjectURL(file),
    videoDuration: 0,
    timelinePosterUrl: null,
    currentTime: 0,
    selectedRange: null,
    selectedSectionId: null,
  }),

  setVideoMeta: (meta) => set({
    videoDuration: Number.isFinite(meta.duration) && meta.duration > 0 ? meta.duration : 0,
    timelinePosterUrl: meta.timelinePosterUrl,
  }),

  setSrtItems: (items, isRTL) => set({
    srtItems: items,
    isRTL,
    selectedRange: null,
    hiddenSentenceByIndex: {},
    selectedSectionId: null,
  }),

  setSections: (sections) => set({ sections, selectedRange: null, selectedSectionId: null }),

  setSelectedIndex: (index, checked) => set((state) => {
    if (!Number.isFinite(index) || index < 0) return {}

    const cur = state.selectedRange
    if (checked) {
      if (!cur) return { selectedSectionId: null, selectedRange: { start: index, end: index } }
      return {
        selectedSectionId: null,
        selectedRange: {
          start: Math.min(cur.start, index),
          end: Math.max(cur.end, index),
        },
      }
    }

    // Uncheck
    if (!cur) return {}
    if (index < cur.start || index > cur.end) return {}
    if (cur.start === cur.end && index === cur.start) return { selectedSectionId: null, selectedRange: null }

    // If unchecking an endpoint, shrink; if unchecking in the middle, clear (deterministic).
    if (index === cur.start) return { selectedSectionId: null, selectedRange: { start: cur.start + 1, end: cur.end } }
    if (index === cur.end) return { selectedSectionId: null, selectedRange: { start: cur.start, end: cur.end - 1 } }
    return { selectedSectionId: null, selectedRange: null }
  }),

  setSelectedSectionId: (id) => set((state) => ({
    selectedSectionId: state.selectedSectionId === id ? null : id,
    selectedRange: null,
  })),

  clearSelection: () => set({ selectedRange: null, selectedSectionId: null }),

  hideSelectedSentences: () => set((state) => {
    const range = state.selectedRange
    if (!range) return {}
    const start = Math.min(range.start, range.end)
    const end = Math.max(range.start, range.end)

    const next: Record<number, true> = { ...state.hiddenSentenceByIndex }
    for (let i = start; i <= end; i++) {
      if (!Number.isFinite(i) || i < 0) continue
      next[i] = true
    }
    return { hiddenSentenceByIndex: next }
  }),

  unhideSelectedSentences: () => set((state) => {
    const range = state.selectedRange
    if (!range) return {}
    const start = Math.min(range.start, range.end)
    const end = Math.max(range.start, range.end)

    const next: Record<number, true> = { ...state.hiddenSentenceByIndex }
    for (let i = start; i <= end; i++) {
      if (!Number.isFinite(i) || i < 0) continue
      delete next[i]
    }
    return { hiddenSentenceByIndex: next }
  }),

  setIsGenerating: (val) => set({ isGenerating: val }),

  setGenerateProgress: (val) => set({
    generateProgress: Math.max(0, Math.min(100, Math.round(val)))
  }),

  setGenerateError: (err) => set({ generateError: err }),

  setCurrentTime: (t) => set({ currentTime: t }),

  toggleSection: (id) => set((state) => ({
    sections: state.sections.map(s =>
      s.id === id ? { ...s, isEnabled: !s.isEnabled } : s
    )
  })),

  renameSection: (id, title) => set((state) => ({
    sections: state.sections.map(s =>
      s.id === id ? { ...s, title } : s
    )
  })),

  moveSentenceUp: (sectionId, itemIndex) => set((state) => {
    const sections = [...state.sections]
    const fromIdx = sections.findIndex(s => s.id === sectionId)
    if (fromIdx <= 0) return {}
    const toIdx = fromIdx - 1

    const fromSection = { ...sections[fromIdx], items: [...sections[fromIdx].items] }
    const toSection = { ...sections[toIdx], items: [...sections[toIdx].items] }

    const idx = Math.min(Math.max(0, itemIndex), fromSection.items.length - 1)
    const [item] = fromSection.items.splice(idx, 1)
    if (!item) return {}
    toSection.items.push(item)

    fromSection.items = normalizeItems(fromSection.items)
    toSection.items = normalizeItems(toSection.items)

    sections[fromIdx] = fromSection
    sections[toIdx] = toSection
    return { sections }
  }),

  moveSentenceDown: (sectionId, itemIndex) => set((state) => {
    const sections = [...state.sections]
    const fromIdx = sections.findIndex(s => s.id === sectionId)
    if (fromIdx >= sections.length - 1) return {}
    const toIdx = fromIdx + 1

    const fromSection = { ...sections[fromIdx], items: [...sections[fromIdx].items] }
    const toSection = { ...sections[toIdx], items: [...sections[toIdx].items] }

    const idx = Math.min(Math.max(0, itemIndex), fromSection.items.length - 1)
    const [item] = fromSection.items.splice(idx, 1)
    if (!item) return {}
    toSection.items.unshift(item)

    fromSection.items = normalizeItems(fromSection.items)
    toSection.items = normalizeItems(toSection.items)

    sections[fromIdx] = fromSection
    sections[toIdx] = toSection
    return { sections }
  }),

  moveSelectionToPrevSection: () => set((state) => {
    const range = state.selectedRange
    if (!range) return {}
    const start = Math.min(range.start, range.end)
    const end = Math.max(range.start, range.end)
    const within = rangeWithinSingleSection(state.sections, { start, end })
    if (!within) return {}
    if (within.sectionIndex <= 0) return {}

    const sections = [...state.sections]
    const fromIdx = within.sectionIndex
    const toIdx = fromIdx - 1
    const from = { ...sections[fromIdx], items: [...sections[fromIdx].items] }
    const to = { ...sections[toIdx], items: [...sections[toIdx].items] }

    const moving: SrtItem[] = []
    const remaining: SrtItem[] = []
    for (const it of from.items) {
      const i = it.index
      if (i >= start && i <= end) moving.push(it)
      else remaining.push(it)
    }
    if (moving.length === 0) return {}

    from.items = normalizeItems(remaining)
    to.items = normalizeItems([...to.items, ...moving])
    sections[fromIdx] = from
    sections[toIdx] = to

    // Guard against empty sections: merge empty into previous (which is `to`) by removing it.
    if (from.items.length === 0) {
      sections.splice(fromIdx, 1)
    }

    return { sections, selectedRange: null, selectedSectionId: null }
  }),

  moveSelectionToNextSection: () => set((state) => {
    const range = state.selectedRange
    if (!range) return {}
    const start = Math.min(range.start, range.end)
    const end = Math.max(range.start, range.end)
    const within = rangeWithinSingleSection(state.sections, { start, end })
    if (!within) return {}
    if (within.sectionIndex >= state.sections.length - 1) return {}

    const sections = [...state.sections]
    const fromIdx = within.sectionIndex
    const toIdx = fromIdx + 1
    const from = { ...sections[fromIdx], items: [...sections[fromIdx].items] }
    const to = { ...sections[toIdx], items: [...sections[toIdx].items] }

    const moving: SrtItem[] = []
    const remaining: SrtItem[] = []
    for (const it of from.items) {
      const i = it.index
      if (i >= start && i <= end) moving.push(it)
      else remaining.push(it)
    }
    if (moving.length === 0) return {}

    from.items = normalizeItems(remaining)
    to.items = normalizeItems([...moving, ...to.items])
    sections[fromIdx] = from
    sections[toIdx] = to

    if (from.items.length === 0) {
      sections.splice(fromIdx, 1)
    }

    return { sections, selectedRange: null, selectedSectionId: null }
  }),

  createSectionFromSelection: () => set((state) => {
    const range = state.selectedRange
    if (!range) return {}
    const start = Math.min(range.start, range.end)
    const end = Math.max(range.start, range.end)
    const within = rangeWithinSingleSection(state.sections, { start, end })
    if (!within) return {}

    const sections = [...state.sections]
    const fromIdx = within.sectionIndex
    const from = sections[fromIdx]
    if (!from) return {}

    const before: SrtItem[] = []
    const mid: SrtItem[] = []
    const after: SrtItem[] = []
    for (const it of from.items) {
      const i = it.index
      if (i < start) before.push(it)
      else if (i > end) after.push(it)
      else mid.push(it)
    }
    if (mid.length === 0) return {}

    const prevColor =
      before.length > 0
        ? from.color
        : (sections[fromIdx - 1]?.color ?? null)
    const nextColor =
      after.length > 0
        ? from.color
        : (sections[fromIdx + 1]?.color ?? null)
    const newColor = pickSectionColorAvoidingNeighbors({ prevColor, nextColor })

    const newId = nextSectionId(sections)
    const newSection: Section = {
      id: newId,
      title: 'New section',
      description: '',
      color: newColor,
      isEnabled: true,
      items: normalizeItems(mid),
    }

    const nextSections: Section[] = []
    for (let i = 0; i < sections.length; i++) {
      if (i !== fromIdx) {
        nextSections.push(sections[i])
        continue
      }

      if (before.length > 0) {
        nextSections.push({ ...from, items: normalizeItems(before) })
      }
      nextSections.push(newSection)
      if (after.length > 0) {
        nextSections.push({ ...from, items: normalizeItems(after) })
      }
    }

    return { sections: nextSections, selectedRange: null, selectedSectionId: null }
  }),

  removeSelectedSection: () => set((state) => {
    const selectedId = state.selectedSectionId
    if (selectedId == null) return {}

    const sections = [...state.sections]
    if (sections.length <= 1) return {}

    const idx = sections.findIndex(s => s.id === selectedId)
    if (idx < 0) return {}
    const victim = sections[idx]
    if (!victim) return {}

    // Merge into previous by default, except if removing the first section.
    const targetIdx = idx === 0 ? 1 : idx - 1
    const target = sections[targetIdx]
    if (!target) return {}

    const mergedTarget: Section = {
      ...target,
      items: normalizeItems([...target.items, ...victim.items]),
    }

    const next: Section[] = []
    for (let i = 0; i < sections.length; i++) {
      if (i === idx) continue
      if (i === targetIdx) next.push(mergedTarget)
      else next.push(sections[i])
    }

    return { sections: next, selectedRange: null, selectedSectionId: null }
  }),

  generateSections: async () => {
    const { srtItems, setIsGenerating, setGenerateProgress, setSections, setGenerateError } = useStore.getState()

    if (srtItems.length === 0) return

    setIsGenerating(true)
    setGenerateError(null)
    setGenerateProgress(0)

    // We don't get real % progress from the server; show a conservative "waiting" progress
    // that starts a bit slower, then creeps upward and caps at 96% until completion.
    let tick: number | null = null
    const start = Date.now()
    const step = () => {
      const elapsedMs = Date.now() - start
      // A slow-starting curve that keeps creeping upward while waiting.
      // Approaches 96% asymptotically, never reaching it in finite time.
      const cap = 96
      const tauMs = 6000 // larger = slower overall
      const raw = 1 - Math.exp(-elapsedMs / tauMs)
      // Make the beginning feel slower.
      const shaped = Math.pow(raw, 1.2)
      const target = Math.floor(shaped * cap)
      setGenerateProgress(Math.min(cap, target))
    }
    step()
    tick = window.setInterval(step, 120)

    try {
      const { sections, usedFallback } = await segmentTranscript(srtItems)
      // Stop the "waiting" progress ticks and smoothly finish to 100%.
      if (tick !== null) window.clearInterval(tick)
      tick = null

      const from = useStore.getState().generateProgress
      const durationMs = 450
      const finishStart = Date.now()
      await new Promise<void>((resolve) => {
        const id = window.setInterval(() => {
          const t = Math.min(1, (Date.now() - finishStart) / durationMs)
          const eased = 1 - Math.pow(1 - t, 3)
          const next = from + (100 - from) * eased
          setGenerateProgress(next)
          if (t >= 1) {
            window.clearInterval(id)
            resolve()
          }
        }, 16)
      })

      setGenerateProgress(100)
      await new Promise<void>((r) => window.setTimeout(() => r(), 500))
      setSections(sections)
      if (usedFallback) {
        setGenerateError('AI segmentation failed — transcript was split into equal parts. You can adjust sections manually.')
      }
    } catch {
      setGenerateError('Something went wrong. Please try again.')
    } finally {
      if (tick !== null) window.clearInterval(tick)
      setIsGenerating(false)
      // Reset so the next run starts clean (and hides instantly when not generating).
      setGenerateProgress(0)
    }
  },
}))

export function assignColors(sections: Omit<Section, 'color'>[]): Section[] {
  return sections.map((s, i) => ({
    ...s,
    color: SECTION_COLORS[i % SECTION_COLORS.length]
  }))
}