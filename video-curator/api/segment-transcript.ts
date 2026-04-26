import type { IncomingMessage, ServerResponse } from 'node:http'

type JsonRequest = IncomingMessage & {
  body?: unknown
}

function sendJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(payload))
}

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function getPrompt(body: unknown): unknown {
  if (!body || typeof body !== 'object') return undefined
  if (!('prompt' in body)) return undefined
  return body.prompt
}

function getOpenAiContent(data: unknown): string | null {
  if (!data || typeof data !== 'object' || !('choices' in data) || !Array.isArray(data.choices)) {
    return null
  }

  const firstChoice = data.choices[0]
  if (!firstChoice || typeof firstChoice !== 'object' || !('message' in firstChoice)) return null

  const message = firstChoice.message
  if (!message || typeof message !== 'object' || !('content' in message)) return null

  return typeof message.content === 'string' ? message.content : null
}

export default async function handler(req: JsonRequest, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' })
    return
  }

  // Prefer server-only var name. Allow legacy VITE_OPENAI_KEY as fallback.
  const apiKey = process.env.OPENAI_API_KEY || process.env.VITE_OPENAI_KEY
  if (!apiKey) {
    sendJson(res, 500, { error: 'Missing OPENAI_API_KEY on server' })
    return
  }

  let body: unknown = null
  try {
    // Vercel Node functions usually give parsed JSON, but handle raw body just in case.
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body
  } catch {
    body = null
  }

  const prompt = getPrompt(body)
  if (!prompt || typeof prompt !== 'string') {
    sendJson(res, 400, { error: 'Missing prompt' })
    return
  }

  try {
    const upstream = await fetch('https://api.openai.com/v1/chat/completions', {
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

    const text = await upstream.text()
    if (!upstream.ok) {
      sendJson(res, upstream.status, { error: `OpenAI API error: ${upstream.status}`, details: text })
      return
    }

    const data: unknown = JSON.parse(text)
    const content = getOpenAiContent(data)

    if (!content) {
      sendJson(res, 502, { error: 'OpenAI response missing content' })
      return
    }

    sendJson(res, 200, { content })
  } catch (err: unknown) {
    sendJson(res, 500, { error: 'Server error', details: getErrorMessage(err) })
  }
}

