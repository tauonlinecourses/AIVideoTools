import type { SrtItem } from './parseSrt'

export type YoutubeTranscriptImportResult = {
  items: SrtItem[]
  title?: string
  videoId: string
}

type SegmentDTO = {
  startTime: number
  endTime: number
  text: string
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

function parseSegments(items: unknown): SegmentDTO[] {
  if (!Array.isArray(items)) {
    return []
  }
  const out: SegmentDTO[] = []
  for (const row of items) {
    if (!row || typeof row !== 'object') {
      continue
    }
    const r = row as { startTime?: unknown; endTime?: unknown; text?: unknown }
    if (!isFiniteNumber(r.startTime) || !isFiniteNumber(r.endTime) || typeof r.text !== 'string') {
      continue
    }
    out.push({ startTime: r.startTime, endTime: r.endTime, text: r.text })
  }
  return out
}

/**
 * Fetches YouTube auto captions via `POST /api/youtube-transcript` and maps them to `SrtItem[]`.
 */
export async function fetchYoutubeTranscriptAsSrtItems(
  url: string,
  options?: { lang?: string }
): Promise<YoutubeTranscriptImportResult> {
  const trimmed = url.trim()
  if (!trimmed) {
    throw new Error('Paste a YouTube URL or video ID.')
  }

  const lang = options?.lang?.trim() || undefined

  const response = await fetch('/api/youtube-transcript', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: trimmed, ...(lang ? { lang } : {}) }),
  })

  let data: unknown
  try {
    data = await response.json()
  } catch {
    throw new Error('Invalid response from server.')
  }

  const obj = data as { error?: unknown; items?: unknown; title?: unknown; videoId?: unknown }

  if (!response.ok) {
    const msg = typeof obj.error === 'string' ? obj.error : `Request failed (${response.status})`
    throw new Error(msg)
  }

  const videoId = typeof obj.videoId === 'string' ? obj.videoId : ''
  if (!videoId) {
    throw new Error('Server response missing videoId.')
  }

  const segments = parseSegments(obj.items)
  if (segments.length === 0) {
    throw new Error('No transcript segments in server response.')
  }

  const items: SrtItem[] = segments.map((seg, index) => ({
    index,
    startTime: seg.startTime,
    endTime: seg.endTime,
    text: seg.text,
  }))

  const title = typeof obj.title === 'string' ? obj.title : undefined

  return { items, title, videoId }
}
