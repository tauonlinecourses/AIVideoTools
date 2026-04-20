import type { SrtItem } from './parseSrt'
import type { Section } from './store'
import { assignColors } from './store'

const MAX_CHARS = 12000

interface GptSection {
  id: number
  title: string
  sentenceIndices: number[]
}

interface GptResponse {
  sections: GptSection[]
}

function buildTranscriptText(items: SrtItem[]): string {
  return items
    .map(item => `[${item.index}] ${item.text}`)
    .join('\n')
}

function buildPrompt(transcriptText: string, totalItems: number): string {
  return `You are an expert educational content editor. Your job is to analyze a video transcript and group its sentences into logical, meaningful sections based on topic changes.

TRANSCRIPT:
${transcriptText}

INSTRUCTIONS:
- Each line starts with [N] where N is the sentence index
- There are exactly ${totalItems} sentences, with indices 0..${Math.max(0, totalItems - 1)}
- Group consecutive sentences into sections based on topic or concept changes
- Aim for 4 to 8 sections total — not too granular, not too broad
- Every sentence index must appear in exactly one section — no gaps, no duplicates
- Sections must be in order and contain consecutive indices only
- Give each section a short, clear English title (3-6 words) that describes the topic
- Return ONLY a valid JSON object, no explanation, no markdown, no backticks

REQUIRED JSON FORMAT:
{
  "sections": [
    {
      "id": 1,
      "title": "Introduction and Overview",
      "sentenceIndices": [0, 1, 2, 3]
    },
    {
      "id": 2,
      "title": "Core Concept Explained",
      "sentenceIndices": [4, 5, 6, 7, 8]
    }
  ]
}`
}

function validateResponse(data: GptResponse, totalItems: number): string | null {
  if (!data.sections || !Array.isArray(data.sections)) {
    return 'Response missing sections array'
  }

  const allIndices = data.sections.flatMap(s => s.sentenceIndices)

  if (allIndices.length !== totalItems) {
    return `Expected ${totalItems} indices, got ${allIndices.length}`
  }

  const sorted = [...allIndices].sort((a, b) => a - b)
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i] !== i) return `Missing or duplicate index: expected ${i}, got ${sorted[i]}`
  }

  for (const section of data.sections) {
    if (!section.title || typeof section.title !== 'string') {
      return 'Section missing title'
    }
    if (!section.sentenceIndices || section.sentenceIndices.length === 0) {
      return 'Section has no sentences'
    }
  }

  return null
}

function repairPartialResponse(data: GptResponse, totalItems: number): { repaired: GptResponse; wasRepaired: boolean } {
  if (!data?.sections || !Array.isArray(data.sections) || totalItems <= 0) {
    return { repaired: { sections: [] }, wasRepaired: false }
  }

  // Build a per-index owner title map. First writer wins, ignore out-of-range indices.
  const ownerTitle: Array<string | null> = Array.from({ length: totalItems }, () => null)
  for (const section of data.sections) {
    if (!section || typeof section.title !== 'string' || !Array.isArray(section.sentenceIndices)) continue
    for (const idx of section.sentenceIndices) {
      if (typeof idx !== 'number') continue
      if (idx < 0 || idx >= totalItems) continue
      if (ownerTitle[idx] === null) ownerTitle[idx] = section.title
    }
  }

  const allCovered = ownerTitle.every(t => t !== null)
  const hasNoDuplicatesOrGaps =
    allCovered &&
    (() => {
      // Ensure each index assigned exactly once (true by construction if allCovered).
      return true
    })()

  if (hasNoDuplicatesOrGaps) return { repaired: data, wasRepaired: false }

  // Reconstruct sections as consecutive runs across 0..N-1.
  const repairedSections: GptSection[] = []
  let nextId = 1
  let unassignedBlock = 0

  const titleFor = (t: string | null) => {
    if (t) return t
    unassignedBlock += 1
    return unassignedBlock === 1 ? 'Unassigned' : `Unassigned (${unassignedBlock})`
  }

  let i = 0
  while (i < totalItems) {
    const runTitle = titleFor(ownerTitle[i])
    const runIndices: number[] = [i]
    i += 1

    while (i < totalItems) {
      const t = ownerTitle[i]
      // Keep same run if same title OR both unassigned (null).
      const same =
        (t === null && runTitle.startsWith('Unassigned')) ||
        (t !== null && t === runTitle)
      if (!same) break
      runIndices.push(i)
      i += 1
    }

    repairedSections.push({
      id: nextId++,
      title: runTitle,
      sentenceIndices: runIndices,
    })
  }

  return { repaired: { sections: repairedSections }, wasRepaired: true }
}

function buildEqualChunkFallback(items: SrtItem[]): Section[] {
  const CHUNK_COUNT = 5
  const chunkSize = Math.ceil(items.length / CHUNK_COUNT)
  const labels = [
    'Introduction',
    'Part One',
    'Part Two',
    'Part Three',
    'Conclusion',
  ]

  const raw = Array.from({ length: CHUNK_COUNT }, (_, i) => ({
    id: i + 1,
    title: labels[i] ?? `Part ${i + 1}`,
    isEnabled: true,
    items: items.slice(i * chunkSize, (i + 1) * chunkSize),
  })).filter(s => s.items.length > 0)

  return assignColors(raw)
}

export async function segmentTranscript(
  items: SrtItem[]
): Promise<{ sections: Section[]; usedFallback: boolean }> {
  // Truncate if transcript is very long
  const transcriptText = buildTranscriptText(
    items.length > MAX_CHARS
      ? items.slice(0, MAX_CHARS)
      : items
  )

  const prompt = buildPrompt(transcriptText, items.length)

  let rawJson: string | null = null

  try {
    const response = await fetch('/api/segment-transcript', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt,
      }),
    })

    if (!response.ok) {
      let details = ''
      try {
        details = await response.text()
      } catch {
        // ignore
      }
      throw new Error(`Segmentation API error: ${response.status}${details ? ` — ${details}` : ''}`)
    }

    const data = await response.json()
    rawJson = data.content

    const parsed: GptResponse = JSON.parse(rawJson!)
    const { repaired, wasRepaired } = repairPartialResponse(parsed, items.length)
    const validationError = validateResponse(repaired, items.length)

    if (validationError) {
      console.warn('Validation failed:', validationError, '— using fallback')
      return { sections: buildEqualChunkFallback(items), usedFallback: true }
    }

    const sections = assignColors(
      repaired.sections.map((s, idx) => ({
        // Keep ids stable-ish even if the model gave weird ids.
        id: Number.isFinite(s.id) ? s.id : idx + 1,
        title: s.title,
        isEnabled: true,
        items: s.sentenceIndices.map(i => items[i]),
      }))
    )

    if (wasRepaired) {
      console.warn('Validation repaired: model returned partial indices — filled gaps with Unassigned sections')
    }
    return { sections, usedFallback: wasRepaired }

  } catch (err) {
    console.warn('Segmentation failed:', err, '— using fallback')
    return { sections: buildEqualChunkFallback(items), usedFallback: true }
  }
}