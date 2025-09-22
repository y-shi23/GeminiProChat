import { GoogleGenerativeAI } from '@fuyun/generative-ai'
import { createParser } from 'eventsource-parser'

// Gemini config
const geminiApiKey = (import.meta.env.GEMINI_API_KEY)
const geminiApiBaseUrl = (import.meta.env.API_BASE_URL)?.trim().replace(/\/$/, '')
const geminiModelName = (import.meta.env.GEMINI_MODEL_NAME) || 'gemini-2.5-flash'

// OpenAI-format config
const providerFromEnv = (import.meta.env.AI_PROVIDER || import.meta.env.MODEL_PROVIDER || '').toLowerCase()
const openaiApiKey = (import.meta.env.OPENAI_API_KEY || import.meta.env.OPENAI_APIKEY || '')
const openaiBaseEnv = (import.meta.env.OPENAI_BASE_URL || import.meta.env.OPENAI_API_BASE || import.meta.env.OPENAI_API_HOST || import.meta.env.OPENAI_API_URL || '').trim()
const openaiModelName = (import.meta.env.OPENAI_MODEL_NAME || import.meta.env.OPENAI_MODEL || 'gpt-4o-mini')
const openaiTemperature = Number(import.meta.env.OPENAI_TEMPERATURE || 0.7)

const resolveOpenAIBase = () => {
  const base = openaiBaseEnv || 'https://api.openai.com'
  const trimmed = base.replace(/\/$/, '')
  return trimmed.match(/\/(v1|v\d+)$/) ? trimmed : `${trimmed}/v1`
}

const detectProvider = () => {
  if (providerFromEnv === 'openai' || providerFromEnv === 'oai' || providerFromEnv === 'chat' || providerFromEnv === 'openai-compatible')
    return 'openai'
  if (providerFromEnv === 'gemini' || providerFromEnv === 'google')
    return 'gemini'
  return openaiApiKey ? 'openai' : 'gemini'
}

const genAI = geminiApiBaseUrl
  ? new GoogleGenerativeAI(geminiApiKey, geminiApiBaseUrl)
  : new GoogleGenerativeAI(geminiApiKey)

async function streamFromOpenAI(history: ChatMessage[], newMessage: string) {
  if (!openaiApiKey)
    throw new Error('OPENAI_API_KEY is required for OpenAI provider')

  const messages = [
    ...history.map(m => ({
      role: m.role === 'model' ? 'assistant' : 'user',
      content: m.parts.map(p => p.text).join(''),
    })),
    { role: 'user', content: newMessage },
  ]

  const url = `${resolveOpenAIBase()}/chat/completions`

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${openaiApiKey}`,
    },
    body: JSON.stringify({
      model: openaiModelName,
      messages,
      temperature: openaiTemperature,
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
        if (event.type !== 'event')
          return
        const data = event.data
        if (data === '[DONE]') {
          controller.close()
          return
        }
        try {
          const json = JSON.parse(data)
          const delta = json?.choices?.[0]?.delta?.content
          if (delta) controller.enqueue(encoder.encode(delta))
        } catch (e) {
          // ignore
        }
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

async function streamFromGemini(history: ChatMessage[], newMessage: string) {
  const model = genAI.getGenerativeModel({ model: geminiModelName })

  const chat = model.startChat({
    history: history.map(msg => ({
      role: msg.role,
      parts: msg.parts.map(part => part.text).join(''),
    })),
    generationConfig: {
      maxOutputTokens: 8000,
    },
    safetySettings: [
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
    ],
  })

  const result = await chat.sendMessageStream(newMessage)

  const encodedStream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      for await (const chunk of (result as any).stream) {
        const text = await chunk.text()
        const encoded = encoder.encode(text)
        controller.enqueue(encoded)
      }
      controller.close()
    },
  })

  return encodedStream
}

export const startChatAndSendMessageStream = async(history: ChatMessage[], newMessage: string) => {
  const provider = detectProvider()
  if (provider === 'openai')
    return await streamFromOpenAI(history, newMessage)
  return await streamFromGemini(history, newMessage)
}
