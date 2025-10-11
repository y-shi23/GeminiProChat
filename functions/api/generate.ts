import { GoogleGenerativeAI } from '@fuyun/generative-ai'
import { createParser } from 'eventsource-parser'

type ChatMessage = {
  role: 'user' | 'model'
  parts: Array<{
    text?: string
    image?: {
      url: string
      name: string
      size: number
      type: string
    }
  }>
}
type Provider = 'openai' | 'gemini'

type ModelConfig = {
  id: string
  label?: string
  provider: Provider
  model: string
  baseUrl?: string
  apiKey?: string
  temperature?: number
}

const readJSON = (val?: string) => {
  if (!val) return null
  try { return JSON.parse(val) } catch { return null }
}

const loadModelsFromEnv = (env: Record<string, string | undefined>): ModelConfig[] => {
  const list: ModelConfig[] = []

  const parsed = readJSON((env.MODELS_JSON || env.AI_MODELS || '') as string)
  if (Array.isArray(parsed) && parsed.length) {
    const fromJson: ModelConfig[] = parsed
      .map((m: any, i: number) => ({
        id: String(m.id || `model_${i + 1}`),
        label: String(m.label || `${m.provider}:${m.model}`),
        provider: (String(m.provider || '').toLowerCase() as Provider),
        model: String(m.model || ''),
        baseUrl: m.baseUrl ? String(m.baseUrl) : undefined,
        apiKey: m.apiKey ? String(m.apiKey) : undefined,
        temperature: (m.temperature != null ? Number(m.temperature) : undefined),
      }))
      .filter(m => (m.provider === 'openai' || m.provider === 'gemini') && m.model)
    list.push(...fromJson)
  }

  const openaiKey = (env.OPENAI_API_KEY || (env as any).OPENAI_APIKEY || '').trim()
  const openaiModel = (env.OPENAI_MODEL_NAME || (env as any).OPENAI_MODEL || '').trim()
  const openaiBase = (env.OPENAI_BASE_URL || (env as any).OPENAI_API_BASE || (env as any).OPENAI_API_HOST || (env as any).OPENAI_API_URL || '').trim()
  const openaiTemp = Number((env.OPENAI_TEMPERATURE || '0.7'))
  if (openaiKey && openaiModel) {
    list.push({ id: 'openai_env', label: 'OpenAI (ENV)', provider: 'openai', model: openaiModel, baseUrl: openaiBase || undefined, apiKey: openaiKey, temperature: openaiTemp })
  }

  const geminiKey = (env.GEMINI_API_KEY || '').trim()
  const geminiBase = (env.API_BASE_URL || '').trim()
  const geminiModel = (env.GEMINI_MODEL_NAME || 'gemini-2.5-flash').trim()
  if (geminiKey) {
    list.push({ id: 'gemini_env', label: 'Gemini (ENV)', provider: 'gemini', model: geminiModel, baseUrl: geminiBase || undefined, apiKey: geminiKey })
  }

  return list
}

const getModelById = (configs: ModelConfig[], id?: string | null): ModelConfig | null => {
  if (!configs.length) return null
  if (!id) return configs[0]
  return configs.find(m => m.id === id) || null
}

const normalizeOpenAIBase = (baseIn?: string) => {
  const base = (baseIn || 'https://api.openai.com')
  const trimmed = base.replace(/\/$/, '')
  return trimmed.match(/\/(v1|v\d+)$/) ? trimmed : `${trimmed}/v1`
}

async function streamFromOpenAI(env: any, history: ChatMessage[], newMessageParts: any[], cfg?: ModelConfig) {
  const apiKey = (cfg?.apiKey || env.OPENAI_API_KEY || env.OPENAI_APIKEY || '').trim()
  if (!apiKey) throw new Error('OPENAI_API_KEY is required for OpenAI provider')

  const messages = [
    ...history.map(m => {
      // If history has only text, use simple string content
      const hasImage = m.parts.some(p => p.image)
      if (!hasImage) {
        return {
          role: m.role === 'model' ? 'assistant' : 'user',
          content: m.parts.map(p => p.text || '').join('')
        }
      }
      // If history has images, use multi-part content format
      const content = []
      for (const part of m.parts) {
        if (part.text) {
          content.push({ type: 'text', text: part.text })
        }
        if (part.image && part.image.url.startsWith('data:')) {
          content.push({
            type: 'image_url',
            image_url: {
              url: part.image.url,
              detail: 'high'
            }
          })
        }
      }
      return {
        role: m.role === 'model' ? 'assistant' : 'user',
        content
      }
    }),
  ]

  // Process the new message parts to handle both text and images
  const content = []
  let hasImage = false

  for (const part of newMessageParts) {
    if (part.text) {
      content.push({
        type: 'text',
        text: part.text
      })
    }
    if (part.image) {
      hasImage = true
      // Image is already in base64 format from frontend
      try {
        // Ensure the base64 data has the correct format
        let base64Url = part.image.url
        if (!base64Url.startsWith('data:')) {
          throw new Error('Invalid image format')
        }

        content.push({
          type: 'image_url',
          image_url: {
            url: base64Url,
            detail: 'high'
          }
        })
      } catch (error) {
        console.error('Failed to process image:', error)
        throw new Error('Failed to process uploaded image')
      }
    }
  }

  // If there's no content, throw an error
  if (content.length === 0) {
    throw new Error('Message must contain text or images')
  }

  messages.push({
    role: 'user',
    content: hasImage ? content : content[0].text
  })

  const base = normalizeOpenAIBase(cfg?.baseUrl || env.OPENAI_BASE_URL || env.OPENAI_API_BASE || env.OPENAI_API_HOST || env.OPENAI_API_URL)
  const url = `${base}/chat/completions`

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: cfg?.model || env.OPENAI_MODEL_NAME || (env as any).OPENAI_MODEL || 'gpt-4o-mini',
      messages,
      temperature: cfg?.temperature ?? Number(env.OPENAI_TEMPERATURE || 0.7),
      stream: true,
    }),
  })

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '')
    const msg = text || `OpenAI request failed with status ${res.status}`
    const err = new Error(msg)
    ;(err as any).name = `HTTP_${res.status}`
    throw err
  }

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      const onParse = (event: any) => {
        if (event.type !== 'event') return
        const data = event.data
        if (data === '[DONE]') { controller.close(); return }
        try {
          const json = JSON.parse(data)
          const choice = json?.choices?.[0]
          const delta = choice?.delta
          let text = ''
          if (typeof delta?.content === 'string') text = delta.content
          else if (Array.isArray(delta?.content)) text = delta.content.map((p: any) => p?.text || p?.content || '').join('')
          else if (typeof (choice as any)?.text === 'string') text = (choice as any).text
          if (text) controller.enqueue(encoder.encode(text))
        } catch {}
      }
      const parser = createParser(onParse)
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      try {
        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          parser.feed(decoder.decode(value, { stream: true }))
        }
        parser.feed(decoder.decode())
        controller.close()
      } catch (err) {
        controller.error(err)
      }
    },
  })

  return stream
}

async function streamFromGemini(env: any, history: ChatMessage[], newMessageParts: any[], cfg?: ModelConfig) {
  const apiKey = (cfg?.apiKey || env.GEMINI_API_KEY || '').trim()
  const baseUrl = (cfg?.baseUrl || env.API_BASE_URL || '').trim() || undefined
  const modelName = cfg?.model || env.GEMINI_MODEL_NAME || 'gemini-2.5-flash'

  const client = baseUrl ? new GoogleGenerativeAI(apiKey, baseUrl) : new GoogleGenerativeAI(apiKey)
  const model = client.getGenerativeModel({ model: modelName })

  // Convert history parts to Gemini format
  const convertedHistory = history.map(msg => ({
    role: msg.role,
    parts: msg.parts.map(part => {
      if (part.text) return part.text
      if (part.image) {
        // For Gemini, we need to handle inline data
        if (!part.image.url.startsWith('data:')) {
          return ''
        }
        const base64Data = part.image.url.split(',')[1] // Extract base64 data from data URL
        return {
          inlineData: {
            mimeType: part.image.type,
            data: base64Data
          }
        }
      }
      return ''
    }).filter(Boolean)
  }))

  // Convert new message parts to Gemini format
  const parts = []
  for (const part of newMessageParts) {
    if (part.text) {
      parts.push(part.text)
    }
    if (part.image) {
      try {
        // Image is already in base64 format from frontend
        if (!part.image.url.startsWith('data:')) {
          throw new Error('Invalid image format')
        }
        const base64Data = part.image.url.split(',')[1] // Extract base64 data from data URL

        parts.push({
          inlineData: {
            mimeType: part.image.type,
            data: base64Data
          }
        })
      } catch (error) {
        console.error('Failed to process image for Gemini:', error)
        throw new Error('Failed to process uploaded image')
      }
    }
  }

  if (parts.length === 0) {
    throw new Error('Message must contain text or images')
  }

  const chat = model.startChat({
    history: convertedHistory,
    generationConfig: { maxOutputTokens: 8000 },
    safetySettings: [
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
    ],
  })

  const result = await chat.sendMessageStream(parts)
  const encodedStream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      for await (const chunk of (result as any).stream) {
        const text = await chunk.text()
        controller.enqueue(encoder.encode(text))
      }
      controller.close()
    },
  })
  return encodedStream
}

async function sha256Hex(text: string) {
  const data = new TextEncoder().encode(text)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('')
}

export const onRequestPost = async ({ request, env }: any) => {
  try {
    const body = await request.json()
    const { sign, time, messages, pass, modelId } = body || {}

    if (!Array.isArray(messages) || messages.length === 0 || messages[messages.length - 1]?.role !== 'user') {
      return new Response(JSON.stringify({ error: { message: 'Invalid message history: The last message must be from user role.' } }), { status: 400 })
    }

    // Password check
    const sitePassword = (env.SITE_PASSWORD || '').trim()
    const passList = sitePassword ? sitePassword.split(',').map((s: string) => s.trim()) : []
    if (sitePassword && !(pass === sitePassword || passList.includes(pass))) {
      return new Response(JSON.stringify({ error: { message: 'Invalid password.' } }), { status: 401 })
    }

    // Signature check (only when PUBLIC_SECRET_KEY is set)
    const secret = (env.PUBLIC_SECRET_KEY || '').trim()
    if (secret) {
      const lastText = messages[messages.length - 1].parts.map((p: any) => p.text || '').filter(Boolean).join('')
      const expected = await sha256Hex(`${time}:${lastText}:${secret}`)
      if (expected !== sign) {
        return new Response(JSON.stringify({ error: { message: 'Invalid signature.' } }), { status: 401 })
      }
    }

    const history: ChatMessage[] = messages.slice(0, -1)
    const newMessageParts: any[] = messages[messages.length - 1].parts

    const configs = loadModelsFromEnv(env as any)
    let cfg = getModelById(configs, modelId)

    // Fallback selection when no modelId
    if (!cfg) {
      const pref = ((env.AI_PROVIDER || (env as any).MODEL_PROVIDER || '') as string).toLowerCase()
      if (pref === 'openai' && (env.OPENAI_API_KEY || (env as any).OPENAI_APIKEY)) cfg = { id: 'openai_env', provider: 'openai', model: (env.OPENAI_MODEL_NAME || (env as any).OPENAI_MODEL || 'gpt-4o-mini') } as any
      else if (pref === 'gemini' && env.GEMINI_API_KEY) cfg = { id: 'gemini_env', provider: 'gemini', model: (env.GEMINI_MODEL_NAME || 'gemini-2.5-flash') } as any
      else if (env.OPENAI_API_KEY || (env as any).OPENAI_APIKEY) cfg = { id: 'openai_env', provider: 'openai', model: (env.OPENAI_MODEL_NAME || (env as any).OPENAI_MODEL || 'gpt-4o-mini') } as any
      else cfg = { id: 'gemini_env', provider: 'gemini', model: (env.GEMINI_MODEL_NAME || 'gemini-2.5-flash') } as any
    }

    const stream = cfg.provider === 'openai'
      ? await streamFromOpenAI(env, history, newMessageParts, cfg)
      : await streamFromGemini(env, history, newMessageParts, cfg)

    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    })
  } catch (error: any) {
    const message: string = (error?.message || 'Internal Error')
    const regex = /https?:\/\/[^\s]+/g
    const filtered = message.replace(regex, '').trim()
    const parts = filtered.split('[400 Bad Request]')
    const cleanMessage = parts.length > 1 ? parts[1].trim() : filtered
    return new Response(JSON.stringify({ error: { code: error?.name || 'Error', message: cleanMessage } }), { status: 500 })
  }
}
