import type { Section } from '../types/transcript'

export type SectionTimeRange = {
  sectionId: number
  isEnabled: boolean
  start: number
  end: number
}

function safePosNumber(n: number): number | null {
  if (!Number.isFinite(n)) return null
  if (n < 0) return null
  return n
}

function sectionCueMinMax(section: Section): { minStart: number; maxEnd: number } | null {
  if (!section.items || section.items.length === 0) return null
  let minStart = Number.POSITIVE_INFINITY
  let maxEnd = 0
  for (const it of section.items) {
    if (!it) continue
    if (Number.isFinite(it.startTime)) minStart = Math.min(minStart, it.startTime)
    if (Number.isFinite(it.endTime)) maxEnd = Math.max(maxEnd, it.endTime)
  }
  if (!Number.isFinite(minStart) || !Number.isFinite(maxEnd)) return null
  if (maxEnd <= minStart) return null
  return { minStart, maxEnd }
}

/**
 * Computes real-video time ranges for each section using the same padding rules as `Timeline`:
 * - The first section start is clamped to 0 (intro padding).
 * - The last section end is clamped to `videoDuration` when known/positive (outro padding).
 */
export function computeSectionTimeRanges(
  sections: Section[],
  videoDuration: number
): SectionTimeRange[] {
  const safeVideoDuration = safePosNumber(videoDuration)

  const ranges: SectionTimeRange[] = []
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i]
    const mm = sectionCueMinMax(s)
    if (!mm) continue

    const isFirst = i === 0
    const isLast = i === sections.length - 1

    const start = isFirst ? 0 : mm.minStart
    const end = isLast && safeVideoDuration != null ? safeVideoDuration : mm.maxEnd
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue

    ranges.push({
      sectionId: s.id,
      isEnabled: Boolean(s.isEnabled),
      start,
      end,
    })
  }

  // Ensure ranges are ordered by start time (defensive).
  ranges.sort((a, b) => a.start - b.start)
  return ranges
}

