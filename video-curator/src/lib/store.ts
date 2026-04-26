import { create } from 'zustand'
import type { Section, SrtItem } from '../types/transcript'
import { segmentTranscript } from './segmentTranscript'

export type { Section, SrtItem } from '../types/transcript'

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

  // Playback
  currentTime: number

  // Actions
  setVideoFile: (file: File) => void
  setVideoMeta: (meta: { duration: number; timelinePosterUrl: string | null }) => void
  setSrtItems: (items: SrtItem[], isRTL: boolean) => void
  setSections: (sections: Section[]) => void
  setIsGenerating: (val: boolean) => void
  setGenerateProgress: (val: number) => void
  setGenerateError: (err: string | null) => void
  setCurrentTime: (t: number) => void
  toggleSection: (id: number) => void
  renameSection: (id: number, title: string) => void
  moveSentenceUp: (sectionId: number, itemIndex: number) => void
  moveSentenceDown: (sectionId: number, itemIndex: number) => void
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

export const useStore = create<AppState>((set): AppState => ({
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
  currentTime: 0,

  // Actions
  setVideoFile: (file) => set({
    videoFile: file,
    videoUrl: URL.createObjectURL(file),
    videoDuration: 0,
    timelinePosterUrl: null,
    currentTime: 0,
  }),

  setVideoMeta: (meta) => set({
    videoDuration: Number.isFinite(meta.duration) && meta.duration > 0 ? meta.duration : 0,
    timelinePosterUrl: meta.timelinePosterUrl,
  }),

  setSrtItems: (items, isRTL) => set({
    srtItems: items,
    isRTL
  }),

  setSections: (sections) => set({ sections }),

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
    const normalize = (items: SrtItem[]): SrtItem[] =>
      [...items].sort((a, b) => (a.index ?? 0) - (b.index ?? 0))

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

    fromSection.items = normalize(fromSection.items)
    toSection.items = normalize(toSection.items)

    sections[fromIdx] = fromSection
    sections[toIdx] = toSection
    return { sections }
  }),

  moveSentenceDown: (sectionId, itemIndex) => set((state) => {
    const normalize = (items: SrtItem[]): SrtItem[] =>
      [...items].sort((a, b) => (a.index ?? 0) - (b.index ?? 0))

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

    fromSection.items = normalize(fromSection.items)
    toSection.items = normalize(toSection.items)

    sections[fromIdx] = fromSection
    sections[toIdx] = toSection
    return { sections }
  }),
  generateSections: async (): Promise<void> => {
    const { srtItems, setIsGenerating, setGenerateProgress, setSections, setGenerateError } = useStore.getState()

    if (srtItems.length === 0) return

    setIsGenerating(true)
    setGenerateError(null)
    setGenerateProgress(0)

    // We don't get real % progress from the server; show a conservative "waiting" progress
    // that starts a bit slower, then creeps upward and caps at 96% until completion.
    let tick: number | null = null
    const start = Date.now()
    const step = (): void => {
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