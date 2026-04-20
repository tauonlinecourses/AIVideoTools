export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.statusCode = 405
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ error: 'Method not allowed' }))
    return
  }

  // Prefer server-only var name. Allow legacy VITE_OPENAI_KEY as fallback.
  const apiKey = process.env.OPENAI_API_KEY || process.env.VITE_OPENAI_KEY
  if (!apiKey) {
    res.statusCode = 500
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ error: 'Missing OPENAI_API_KEY on server' }))
    return
  }

  let body: any = null
  try {
    // Vercel Node functions usually give parsed JSON, but handle raw body just in case.
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body
  } catch {
    body = null
  }

  const prompt = body?.prompt
  if (!prompt || typeof prompt !== 'string') {
    res.statusCode = 400
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ error: 'Missing prompt' }))
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
      res.statusCode = upstream.status
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ error: `OpenAI API error: ${upstream.status}`, details: text }))
      return
    }

    const data = JSON.parse(text)
    const content = data?.choices?.[0]?.message?.content

    if (!content || typeof content !== 'string') {
      res.statusCode = 502
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ error: 'OpenAI response missing content' }))
      return
    }

    res.statusCode = 200
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ content }))
  } catch (err: any) {
    res.statusCode = 500
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ error: 'Server error', details: String(err?.message ?? err) }))
  }
}

