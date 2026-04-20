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

function buildPrompt(transcriptText: string): string {
  return `You are an expert educational content editor. Your job is to analyze a video transcript and group its sentences into logical, meaningful sections based on topic changes.

TRANSCRIPT:
${transcriptText}

INSTRUCTIONS:
- Each line starts with [N] where N is the sentence index
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
  const apiKey = import.meta.env.VITE_OPENAI_KEY

  // Truncate if transcript is very long
  const transcriptText = buildTranscriptText(
    items.length > MAX_CHARS
      ? items.slice(0, MAX_CHARS)
      : items
  )

  const prompt = buildPrompt(transcriptText)

  let rawJson: string | null = null

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: 'You are a transcript segmentation engine. You only output valid JSON.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
      }),
    })

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`)
    }

    const data = await response.json()
    rawJson = data.choices[0].message.content

    const parsed: GptResponse = JSON.parse(rawJson!)
    const validationError = validateResponse(parsed, items.length)

    if (validationError) {
      console.warn('Validation failed:', validationError, '— using fallback')
      return { sections: buildEqualChunkFallback(items), usedFallback: true }
    }

    const sections = assignColors(
      parsed.sections.map(s => ({
        id: s.id,
        title: s.title,
        isEnabled: true,
        items: s.sentenceIndices.map(i => items[i]),
      }))
    )

    return { sections, usedFallback: false }

  } catch (err) {
    console.warn('Segmentation failed:', err, '— using fallback')
    return { sections: buildEqualChunkFallback(items), usedFallback: true }
  }
}