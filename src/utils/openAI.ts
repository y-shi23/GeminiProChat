import { GoogleGenerativeAI } from '@fuyun/generative-ai'
import { createParser } from 'eventsource-parser'
import { getModelById, loadModelsFromEnv, pickDefaultModelId } from './models'

const normalizeOpenAIBase = (baseIn?: string) => {
  const base = baseIn || 'https://api.openai.com'
  const trimmed = base.replace(/\/$/, '')
  return trimmed.match(/\/(v1|v\d+)$/) ? trimmed : `${trimmed}/v1`
}

async function streamFromOpenAI(history: ChatMessage[], newMessageParts: ChatMessage['parts'], opts?: { baseUrl?: string; apiKey?: string; model?: string; temperature?: number }) {
  const effectiveKey = opts?.apiKey
  if (!effectiveKey)
    throw new Error('API key is required for OpenAI provider')

  const messages = [
    ...history.map(m => ({
      role: m.role === 'model' ? 'assistant' : 'user',
      content: m.parts.map(p => p.text || '').join(''),
    })),
  ]

  // Process the new message parts
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

  const base = normalizeOpenAIBase(opts?.baseUrl?.trim())
  const url = `${base}/chat/completions`

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${effectiveKey}`,
    },
    body: JSON.stringify({
      model: opts?.model,
      messages,
      temperature: opts?.temperature,
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
          const choice = json?.choices?.[0]
          const delta = choice?.delta
          let text = ''
          // OpenAI Chat Completions: delta.content is a string
          if (typeof delta?.content === 'string') text = delta.content
          // Some OpenAI-compatible providers stream content as array parts
          else if (Array.isArray(delta?.content)) {
            text = delta.content.map((p: any) => p?.text || p?.content || '').join('')
          }
          // Fallbacks for non-standard streams
          else if (typeof (choice as any)?.text === 'string') {
            text = (choice as any).text
          }

          if (text) controller.enqueue(encoder.encode(text))
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

async function streamFromGemini(history: ChatMessage[], newMessageParts: ChatMessage['parts'], opts?: { baseUrl?: string; apiKey?: string; model?: string }) {
  const apiKey = opts?.apiKey
  const baseUrl = opts?.baseUrl && opts.baseUrl.trim()
  const modelName = opts?.model

  if (!apiKey)
    throw new Error('API key is required for Gemini provider')

  const client = baseUrl
    ? new GoogleGenerativeAI(apiKey, baseUrl)
    : new GoogleGenerativeAI(apiKey)

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

  const result = await chat.sendMessageStream(parts)

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

export const startChatAndSendMessageStream = async(
  history: ChatMessage[],
  newMessageParts: ChatMessage['parts'],
  modelId?: string | null,
) => {
  // Load models from environment
  const registry = loadModelsFromEnv()

  // Select model
  const targetModelId = modelId || pickDefaultModelId(registry)
  const m = getModelById(registry, targetModelId)

  if (!m)
    throw new Error('Invalid modelId')

  if (m.provider === 'openai')
    return await streamFromOpenAI(history, newMessageParts, { baseUrl: m.baseUrl, apiKey: m.apiKey, model: m.model, temperature: m.temperature })

  return await streamFromGemini(history, newMessageParts, { baseUrl: m.baseUrl, apiKey: m.apiKey, model: m.model })
}
