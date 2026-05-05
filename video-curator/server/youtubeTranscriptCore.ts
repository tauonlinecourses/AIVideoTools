import {
  fetchTranscript,
  YoutubeTranscriptError,
  YoutubeTranscriptNotAvailableLanguageError,
  type TranscriptResponse,
} from 'youtube-transcript'

/** Response segment times in seconds (aligned with `SrtItem` after client adds `index`). */
export type YoutubeTranscriptSegmentDTO = {
  startTime: number
  endTime: number
  text: string
}

const RE_YOUTUBE =
  /(?:youtube\.com\/(?:[^/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?/\s]{11})/i

export function extractYoutubeVideoId(videoIdOrUrl: string): string {
  const s = videoIdOrUrl.trim()
  if (s.length === 11 && !/[/?]/.test(s)) {
    return s
  }
  const m = s.match(RE_YOUTUBE)
  if (m?.[1]) {
    return m[1]
  }
  throw new YoutubeTranscriptError('Impossible to retrieve Youtube video ID.')
}

/**
 * youtube-transcript returns srv3 cues in ms and classic XML in seconds.
 * Heuristic: if mean cue duration is large, treat rows as milliseconds.
 */
export function normalizeTranscriptRows(rows: TranscriptResponse[]): YoutubeTranscriptSegmentDTO[] {
  if (rows.length === 0) {
    return []
  }
  const meanDur = rows.reduce((sum, r) => sum + r.duration, 0) / rows.length
  const useMs = meanDur > 200

  const out: YoutubeTranscriptSegmentDTO[] = []
  for (const row of rows) {
    const start = useMs ? row.offset / 1000 : row.offset
    const dur = useMs ? row.duration / 1000 : row.duration
    const text = row.text.trim()
    if (!text) {
      continue
    }
    out.push({ startTime: start, endTime: start + dur, text })
  }
  return out
}

async function fetchYoutubeOEmbedTitle(videoId: string): Promise<string | undefined> {
  try {
    const watchUrl = encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)
    const res = await fetch(`https://www.youtube.com/oembed?url=${watchUrl}&format=json`)
    if (!res.ok) {
      return undefined
    }
    const data = (await res.json()) as { title?: unknown }
    return typeof data.title === 'string' ? data.title : undefined
  } catch {
    return undefined
  }
}

export type YoutubeTranscriptLoadResult = {
  videoId: string
  items: YoutubeTranscriptSegmentDTO[]
  title?: string
}

export type YoutubeTranscriptLoadOptions = {
  /** ISO language code, e.g. 'he', 'en', 'ar'. If omitted, YouTube's default track is used. */
  lang?: string
}

export async function loadYoutubeTranscriptFromUrl(
  url: string,
  options?: YoutubeTranscriptLoadOptions
): Promise<YoutubeTranscriptLoadResult> {
  const trimmed = url.trim()
  if (!trimmed) {
    throw new YoutubeTranscriptError('Missing YouTube URL.')
  }

  const videoId = extractYoutubeVideoId(trimmed)
  const lang = options?.lang?.trim() || undefined

  const titlePromise = fetchYoutubeOEmbedTitle(videoId)

  const langCandidates =
    lang === 'he'
      ? ['he', 'iw'] // YouTube commonly uses legacy 'iw' for Hebrew
      : lang
        ? [lang]
        : []

  let rows: TranscriptResponse[]
  try {
    if (langCandidates.length === 0) {
      rows = await fetchTranscript(trimmed)
    } else {
      let lastErr: unknown = null
      let got: TranscriptResponse[] | null = null
      for (const candidate of langCandidates) {
        try {
          got = await fetchTranscript(trimmed, { lang: candidate })
          break
        } catch (e: unknown) {
          lastErr = e
          continue
        }
      }
      if (!got) {
        throw lastErr
      }
      rows = got
    }
  } catch (err: unknown) {
    // If user requested Hebrew and only legacy 'iw' exists, be explicit.
    if (err instanceof YoutubeTranscriptNotAvailableLanguageError && lang === 'he') {
      throw err
    }
    throw err
  }

  const title = await titlePromise

  const items = normalizeTranscriptRows(rows)
  if (items.length === 0) {
    throw new YoutubeTranscriptError('No transcript lines returned for this video.')
  }

  return { videoId, items, title }
}

export { YoutubeTranscriptError }
