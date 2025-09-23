import type { APIRoute } from 'astro'
import type { ModelConfig } from '@/utils/models'
import { readFileSync } from 'fs'
import { join } from 'path'

const readJSON = (val?: string) => {
  if (!val) return null
  try {
    return JSON.parse(val)
  } catch (error) {
    return null
  }
}

const loadModelsFromEnv = (): ModelConfig[] => {
  const list: ModelConfig[] = []

  // Read directly from .env file to handle multiline JSON values
  let json = ''
  try {
    const envPath = join(process.cwd(), '.env')
    const envContent = readFileSync(envPath, 'utf8')
    const lines = envContent.split('\n')

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim()
      if (line.startsWith('MODELS_JSON=')) {
        let value = line.slice('MODELS_JSON='.length).trim()

        // Handle multiline JSON values
        if (value.startsWith('[') && !value.endsWith(']')) {
          const valueLines = [value]
          i++
          while (i < lines.length) {
            const nextLine = lines[i]
            valueLines.push(nextLine)
            if (nextLine.trim().endsWith(']')) {
              break
            }
            i++
          }
          value = valueLines.join('\n').trim()
        }

        json = value
        break
      }
    }
  } catch (error) {
    // Fallback to process.env if direct file reading fails
    json = (process.env.MODELS_JSON || '').trim()
  }

  const parsed = readJSON(json)
  if (Array.isArray(parsed) && parsed.length) {
    const fromJson: ModelConfig[] = parsed
      .map((m: any, i: number) => ({
        id: String(m.id || `model_${i + 1}`),
        label: String(m.label || `${m.provider}:${m.model}`),
        provider: (String(m.provider || '').toLowerCase() as 'openai' | 'gemini'),
        model: String(m.model || ''),
        baseUrl: m.baseUrl ? String(m.baseUrl) : undefined,
        apiKey: m.apiKey ? String(m.apiKey) : undefined,
        temperature: (m.temperature != null ? Number(m.temperature) : undefined),
      }))
      .filter(m => (m.provider === 'openai' || m.provider === 'gemini') && m.model)
    list.push(...fromJson)
  }

  // Back-compat single provider envs (merge when MODELS_JSON exists)
  const openaiKey = (process.env.OPENAI_API_KEY || process.env.OPENAI_APIKEY || '').trim()
  const openaiModel = (process.env.OPENAI_MODEL_NAME || process.env.OPENAI_MODEL || '').trim()
  const openaiBase = (process.env.OPENAI_BASE_URL || process.env.OPENAI_API_BASE || process.env.OPENAI_API_HOST || process.env.OPENAI_API_URL || '').trim()
  const openaiTemp = Number(process.env.OPENAI_TEMPERATURE || 0.7)
  if (openaiKey && openaiModel) {
    list.push({ id: 'openai_env', label: 'OpenAI (ENV)', provider: 'openai', model: openaiModel, baseUrl: openaiBase || undefined, apiKey: openaiKey, temperature: openaiTemp })
  }

  // Gemini
  const geminiKey = (process.env.GEMINI_API_KEY || '').trim()
  const geminiBase = (process.env.API_BASE_URL || '').trim()
  const geminiModel = (process.env.GEMINI_MODEL_NAME || 'gemini-2.5-flash').trim()
  if (geminiKey) {
    list.push({ id: 'gemini_env', label: 'Gemini (ENV)', provider: 'gemini', model: geminiModel, baseUrl: geminiBase || undefined, apiKey: geminiKey })
  }

  return list
}

const publicModels = (configs: ModelConfig[]) =>
  configs.map(m => ({ id: m.id, label: m.label || `${m.provider}:${m.model}`, provider: m.provider, model: m.model }))

const pickDefaultModelId = (configs: ModelConfig[]): string | null => {
  if (!configs.length) return null
  const providerPref = (process.env.AI_PROVIDER || '').toLowerCase()
  // If AI_PROVIDER is set, pick first model matching provider
  if (providerPref === 'openai' || providerPref === 'gemini') {
    const found = configs.find(m => m.provider === providerPref)
    if (found) return found.id
  }
  // Optional explicit default
  const explicit = (process.env.DEFAULT_MODEL_ID || '').trim()
  if (explicit) {
    const match = configs.find(m => m.id === explicit)
    if (match) return match.id
  }
  return configs[0].id
}

export const get: APIRoute = async() => {
  const configs = loadModelsFromEnv()
  const items = publicModels(configs)
  const def = pickDefaultModelId(configs)
  return new Response(JSON.stringify({ models: items, defaultModelId: def }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
  })
}

