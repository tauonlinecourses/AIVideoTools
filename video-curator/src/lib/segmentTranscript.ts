import type { SrtItem } from './parseSrt'
import type { Section } from './store'
import { assignColors } from './store'

const MAX_CHARS = 12000
type TitleLanguage = 'en' | 'he'

interface GptSection {
  id: number
  title: string
  description: string
  startIndex: number
  endIndex: number
}

interface GptResponse {
  sections: GptSection[]
}

function buildTranscriptText(items: SrtItem[]): string {
  return items
    .map(item => `[${item.index}] ${item.text}`)
    .join('\n')
}

function buildPrompt(transcriptText: string, totalItems: number, titleLanguage: TitleLanguage): string {
  const titleLanguageLabel = titleLanguage === 'he' ? 'Hebrew' : 'English'
  const titleRule =
    titleLanguage === 'he'
      ? 'Give each section a short, clear Hebrew title (3-6 words) that describes the topic'
      : 'Give each section a short, clear English title (3-6 words) that describes the topic'
  const descriptionRule =
    titleLanguage === 'he'
      ? 'Give each section a 1-2 sentence Hebrew description summarizing what is discussed in that section. Keep it short and editor-friendly.'
      : 'Give each section a 1-2 sentence English description summarizing what is discussed in that section. Keep it short and editor-friendly.'

  const exampleTitle1 = titleLanguage === 'he' ? 'מבוא וסקירה' : 'Introduction and Overview'
  const exampleTitle2 = titleLanguage === 'he' ? 'הסבר הרעיון המרכזי' : 'Core Concept Explained'
  const exampleDesc1 =
    titleLanguage === 'he'
      ? 'הסבר קצר על מה הולך להיות בסרטון ולמה זה חשוב.'
      : 'A brief setup of what the video will cover and why it matters.'
  const exampleDesc2 =
    titleLanguage === 'he'
      ? 'פירוק הרעיון המרכזי לצעדים פשוטים עם דוגמה.'
      : 'Breaks down the core idea into simple steps with an example.'

  return `You are an expert educational content editor. Your job is to analyze a video transcript and group its sentences into logical, meaningful sections based on topic changes.

TRANSCRIPT:
${transcriptText}

INSTRUCTIONS:
- Each line starts with [N] where N is the sentence index
- There are exactly ${totalItems} sentences, with indices 0..${Math.max(0, totalItems - 1)}
- Group consecutive sentences into sections based on topic or concept changes
- Aim for 4 to 8 sections total — not too granular, not too broad
- Every sentence index must appear in exactly one section — no gaps, no duplicates
- CRITICAL: Sections MUST be contiguous ranges. Do not list individual indices.
- CRITICAL: Return each section as startIndex/endIndex boundaries (inclusive).
- CRITICAL: Across sections, ranges must be back-to-back and in order (if one ends at k, next starts at k+1)
- Section titles must be in ${titleLanguageLabel}
- ${titleRule}
- ${descriptionRule}
- SELF-CHECK BEFORE RETURNING JSON:
  - The first section must startIndex=0.
  - For each adjacent pair: next.startIndex must equal prev.endIndex+1.
  - The last section must endIndex=${Math.max(0, totalItems - 1)}.
  - If you cannot satisfy ALL constraints, return exactly: { "sections": [] }
- Return ONLY a valid JSON object, no explanation, no markdown, no backticks

REQUIRED JSON FORMAT:
{
  "sections": [
    {
      "id": 1,
      "title": "${exampleTitle1}",
      "description": "${exampleDesc1}",
      "startIndex": 0,
      "endIndex": 3
    },
    {
      "id": 2,
      "title": "${exampleTitle2}",
      "description": "${exampleDesc2}",
      "startIndex": 4,
      "endIndex": 8
    }
  ]
}`
}

function withStrictAddendum(prompt: string): string {
  return `${prompt}

STRICT ADDENDUM (must follow):
- Return { "sections": [] } unless every section is a single consecutive range and sections partition indices in order.
`
}

function validateResponse(data: GptResponse, totalItems: number): string | null {
  if (!data.sections || !Array.isArray(data.sections)) {
    return 'Response missing sections array'
  }

  // Fast path: allow explicit "can't comply" empty result.
  if (totalItems === 0) return null
  if (data.sections.length === 0) return 'No sections returned'

  for (const section of data.sections) {
    if (!section.title || typeof section.title !== 'string') {
      return 'Section missing title'
    }
    if (!section.description || typeof section.description !== 'string') {
      return 'Section missing description'
    }
    if (!Number.isFinite(section.startIndex) || !Number.isFinite(section.endIndex)) return 'Section missing startIndex/endIndex'
    if (section.startIndex < 0 || section.endIndex < 0) return 'Section has negative index'
    if (section.startIndex > section.endIndex) return 'Section has startIndex > endIndex'
  }

  // Enforce contiguity and order:
  // - Sections must partition 0..N-1 in order (back-to-back runs)
  let expectedStart = 0
  for (let s = 0; s < data.sections.length; s++) {
    const section = data.sections[s]
    const start = Math.trunc(section.startIndex)
    const end = Math.trunc(section.endIndex)
    if (start !== expectedStart) {
      return `Sections not contiguous: expected section to start at ${expectedStart}, got ${start}`
    }
    expectedStart = end + 1
  }
  if (expectedStart !== totalItems) {
    return `Sections do not cover transcript in order: ended at ${expectedStart - 1}, expected ${totalItems - 1}`
  }

  return null
}

function repairPartialResponse(
  data: GptResponse,
  totalItems: number,
  titleLanguage: TitleLanguage
): { repaired: GptResponse; wasRepaired: boolean } {
  if (!data?.sections || !Array.isArray(data.sections) || totalItems <= 0) {
    return { repaired: { sections: [] }, wasRepaired: false }
  }

  // Build a per-index owner maps. First writer wins, ignore out-of-range indices.
  const ownerTitle: Array<string | null> = Array.from({ length: totalItems }, () => null)
  const ownerDescription: Array<string | null> = Array.from({ length: totalItems }, () => null)
  for (const section of data.sections) {
    if (!section || typeof section.title !== 'string') continue
    const desc = typeof section.description === 'string' ? section.description : ''
    const start = Math.trunc(Number(section.startIndex))
    const end = Math.trunc(Number(section.endIndex))
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue
    for (let idx = start; idx <= end; idx++) {
      if (idx < 0 || idx >= totalItems) continue
      if (ownerTitle[idx] === null) ownerTitle[idx] = section.title
      if (ownerDescription[idx] === null) ownerDescription[idx] = desc
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
    const base = titleLanguage === 'he' ? 'לא משויך' : 'Unassigned'
    return unassignedBlock === 1 ? base : `${base} (${unassignedBlock})`
  }

  const descriptionFor = (d: string | null) => {
    if (d && d.trim().length > 0) return d.trim()
    return titleLanguage === 'he'
      ? 'קטע שלא שויך אוטומטית לסעיף.'
      : 'A segment that was not automatically assigned to a section.'
  }

  let i = 0
  while (i < totalItems) {
    const runTitle = titleFor(ownerTitle[i])
    const runDesc = descriptionFor(ownerDescription[i])
    const runStart = i
    i += 1

    while (i < totalItems) {
      const t = ownerTitle[i]
      const d = ownerDescription[i]
      // Keep same run if same title OR both unassigned (null).
      const same =
        (t === null && runTitle.startsWith('Unassigned')) ||
        (t !== null && t === runTitle)
      if (!same) break

      // If title matches but description differs, split to avoid mixing descriptions.
      const nextDesc = descriptionFor(d)
      if (nextDesc !== runDesc) break
      i += 1
    }

    repairedSections.push({
      id: nextId++,
      title: runTitle,
      description: runDesc,
      startIndex: runStart,
      endIndex: i - 1,
    })
  }

  return { repaired: { sections: repairedSections }, wasRepaired: true }
}

function buildEqualChunkFallback(items: SrtItem[], titleLanguage: TitleLanguage): Section[] {
  const CHUNK_COUNT = 5
  const chunkSize = Math.ceil(items.length / CHUNK_COUNT)
  const labels =
    titleLanguage === 'he'
      ? ['מבוא', 'חלק ראשון', 'חלק שני', 'חלק שלישי', 'סיכום']
      : ['Introduction', 'Part One', 'Part Two', 'Part Three', 'Conclusion']

  const raw = Array.from({ length: CHUNK_COUNT }, (_, i) => ({
    id: i + 1,
    title: labels[i] ?? `Part ${i + 1}`,
    description: '',
    isEnabled: true,
    items: items.slice(i * chunkSize, (i + 1) * chunkSize),
  })).filter(s => s.items.length > 0)

  return assignColors(raw)
}

function detectTitleLanguage(items: SrtItem[]): TitleLanguage {
  // Heuristic: prefer Hebrew if there's a meaningful amount of Hebrew letters
  // and they dominate Latin letters. (Avoid using isRTL since RTL can include Arabic.)
  const sample = items.slice(0, 200)
  let hebrew = 0
  let latin = 0

  for (const it of sample) {
    const text = it.text ?? ''
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i)
      if (code >= 0x0590 && code <= 0x05FF) hebrew += 1
      else if ((code >= 0x41 && code <= 0x5A) || (code >= 0x61 && code <= 0x7A)) latin += 1
    }
  }

  if (hebrew >= 20 && hebrew >= latin * 1.2) return 'he'
  return 'en'
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

  const titleLanguage = detectTitleLanguage(items)
  const basePrompt = buildPrompt(transcriptText, items.length, titleLanguage)

  const tryOnce = async (
    prompt: string
  ): Promise<{ sections: Section[]; usedFallback: boolean } | null> => {
    const response = await fetch('/api/segment-transcript', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prompt }),
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
    const rawJson: string = data.content

    const parsed: GptResponse = JSON.parse(rawJson)
    const { repaired, wasRepaired } = repairPartialResponse(parsed, items.length, titleLanguage)
    const validationError = validateResponse(repaired, items.length)
    if (validationError) {
      console.warn('Validation failed:', validationError)
      return null
    }

    const sections = assignColors(
      repaired.sections.map((s, idx) => {
        const start = Math.trunc(s.startIndex)
        const end = Math.trunc(s.endIndex)
        return {
          // Keep ids stable-ish even if the model gave weird ids.
          id: Number.isFinite(s.id) ? s.id : idx + 1,
          title: s.title,
          description: typeof s.description === 'string' ? s.description : '',
          isEnabled: true,
          items: items.slice(start, end + 1),
        }
      })
    )

    if (wasRepaired) {
      console.warn('Validation repaired: model returned partial indices — filled gaps with Unassigned sections')
    }
    return { sections, usedFallback: wasRepaired }
  }

  try {
    const first = await tryOnce(basePrompt)
    if (first) return first

    const second = await tryOnce(withStrictAddendum(basePrompt))
    if (second) return second

    console.warn('Validation failed after retry — using fallback')
    return { sections: buildEqualChunkFallback(items, titleLanguage), usedFallback: true }
  } catch (err) {
    console.warn('Segmentation failed:', err, '— using fallback')
    return { sections: buildEqualChunkFallback(items, titleLanguage), usedFallback: true }
  }
}