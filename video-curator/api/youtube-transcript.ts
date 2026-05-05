import { YoutubeTranscriptTooManyRequestError } from 'youtube-transcript'
import { YoutubeTranscriptError, loadYoutubeTranscriptFromUrl } from '../server/youtubeTranscriptCore'

type VercelishResponse = {
  statusCode?: number
  setHeader: (name: string, value: string) => void
  end: (body: string) => void
}

export default async function handler(req: { method?: string; body?: unknown }, res: VercelishResponse) {
  if (req.method !== 'POST') {
    res.statusCode = 405
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ error: 'Method not allowed' }))
    return
  }

  let body: unknown = req.body
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body)
    } catch {
      body = null
    }
  }

  const url =
    body && typeof body === 'object' && body !== null && 'url' in body
      ? (body as { url?: unknown }).url
      : undefined

  const lang =
    body && typeof body === 'object' && body !== null && 'lang' in body
      ? (body as { lang?: unknown }).lang
      : undefined

  if (!url || typeof url !== 'string') {
    res.statusCode = 400
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ error: 'Missing url' }))
    return
  }

  try {
    const langOpt = typeof lang === 'string' && lang.trim() ? lang.trim() : undefined
    const { items, title, videoId } = await loadYoutubeTranscriptFromUrl(url, langOpt ? { lang: langOpt } : undefined)
    res.statusCode = 200
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ items, title, videoId }))
  } catch (err: unknown) {
    if (err instanceof YoutubeTranscriptError) {
      const tooMany = err instanceof YoutubeTranscriptTooManyRequestError
      res.statusCode = tooMany ? 429 : 400
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ error: err.message }))
      return
    }
    res.statusCode = 500
    res.setHeader('Content-Type', 'application/json')
    const message = err instanceof Error ? err.message : String(err)
    res.end(JSON.stringify({ error: 'Server error', details: message }))
  }
}
