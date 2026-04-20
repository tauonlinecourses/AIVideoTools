import { create } from 'zustand'
import type { SrtItem } from './parseSrt'

export interface Section {
  id: number
  title: string
  color: string
  isEnabled: boolean
  items: SrtItem[]
}

export interface AppState {
  // Files
  videoFile: File | null
  videoUrl: string | null
  rawSrt: string | null

  // Parsed data
  srtItems: SrtItem[]
  isRTL: boolean

  // Sections
  sections: Section[]
  isGenerating: boolean
  generateError: string | null

  // Playback
  currentTime: number

  // Actions
  setVideoFile: (file: File) => void
  setSrtItems: (items: SrtItem[], isRTL: boolean) => void
  setSections: (sections: Section[]) => void
  setIsGenerating: (val: boolean) => void
  setGenerateError: (err: string | null) => void
  setCurrentTime: (t: number) => void
  toggleSection: (id: number) => void
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

export const useStore = create<AppState>((set) => ({
  // Initial state
  videoFile: null,
  videoUrl: null,
  rawSrt: null,
  srtItems: [],
  isRTL: false,
  sections: [],
  isGenerating: false,
  generateError: null,
  currentTime: 0,

  // Actions
  setVideoFile: (file) => set({
    videoFile: file,
    videoUrl: URL.createObjectURL(file)
  }),

  setSrtItems: (items, isRTL) => set({
    srtItems: items,
    isRTL
  }),

  setSections: (sections) => set({ sections }),

  setIsGenerating: (val) => set({ isGenerating: val }),

  setGenerateError: (err) => set({ generateError: err }),

  setCurrentTime: (t) => set({ currentTime: t }),

  toggleSection: (id) => set((state) => ({
    sections: state.sections.map(s =>
      s.id === id ? { ...s, isEnabled: !s.isEnabled } : s
    )
  })),

  moveSentenceUp: (sectionId, itemIndex) => set((state) => {
    const sections = [...state.sections]
    const fromIdx = sections.findIndex(s => s.id === sectionId)
    if (fromIdx <= 0) return {}
    const toIdx = fromIdx - 1

    const fromSection = { ...sections[fromIdx], items: [...sections[fromIdx].items] }
    const toSection = { ...sections[toIdx], items: [...sections[toIdx].items] }

    const [item] = fromSection.items.splice(0, 1)
    toSection.items.push(item)

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

    const [item] = fromSection.items.splice(-1, 1)
    toSection.items.unshift(item)

    sections[fromIdx] = fromSection
    sections[toIdx] = toSection
    return { sections }
  }),
  generateSections: async () => {
    const { srtItems, setIsGenerating, setSections, setGenerateError } = useStore.getState()

    if (srtItems.length === 0) return

    setIsGenerating(true)
    setGenerateError(null)

    try {
      const { sections, usedFallback } = await segmentTranscript(srtItems)
      setSections(sections)
      if (usedFallback) {
        setGenerateError('AI segmentation failed — transcript was split into equal parts. You can adjust sections manually.')
      }
    } catch (err) {
      setGenerateError('Something went wrong. Please try again.')
    } finally {
      setIsGenerating(false)
    }
  },
}))

export function assignColors(sections: Omit<Section, 'color'>[]): Section[] {
  return sections.map((s, i) => ({
    ...s,
    color: SECTION_COLORS[i % SECTION_COLORS.length]
  }))
}