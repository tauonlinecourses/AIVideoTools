import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // Prefer server-only var name. Allow legacy VITE_OPENAI_KEY for local dev convenience.
  const apiKey = env.OPENAI_API_KEY || env.VITE_OPENAI_KEY

  return {
    plugins: [
      react(),
      {
        name: 'local-openai-segmentation-api',
        configureServer(server) {
          server.middlewares.use('/api/segment-transcript', async (req, res) => {
            if (req.method !== 'POST') {
              res.statusCode = 405
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ error: 'Method not allowed' }))
              return
            }

            if (!apiKey) {
              res.statusCode = 500
              res.setHeader('Content-Type', 'application/json')
              res.end(
                JSON.stringify({
                  error: 'Missing OPENAI_API_KEY (preferred). For local dev only you may also set VITE_OPENAI_KEY in video-curator/.env.local',
                })
              )
              return
            }

            let raw = ''
            req.on('data', (chunk) => (raw += chunk))
            req.on('end', async () => {
              let body: unknown = null
              try {
                body = JSON.parse(raw || '{}')
              } catch {
                body = null
              }

              const prompt =
                body && typeof body === 'object' && 'prompt' in body ? (body as { prompt?: unknown }).prompt : undefined
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
                      { role: 'user', content: prompt },
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
              } catch (err: unknown) {
                res.statusCode = 500
                res.setHeader('Content-Type', 'application/json')
                const message = err instanceof Error ? err.message : String(err)
                res.end(JSON.stringify({ error: 'Server error', details: message }))
              }
            })
          })
        },
      },
    ],
  }
})
