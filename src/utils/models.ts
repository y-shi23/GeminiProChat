import type { ChatMessage } from '@/types'
import { readFileSync } from 'fs'
import { join } from 'path'

export type Provider = 'openai' | 'gemini'

export interface ModelConfig {
  id: string
  label?: string
  provider: Provider
  model: string
  baseUrl?: string
  apiKey?: string
  temperature?: number
}

export interface PublicModelOption {
  id: string
  label: string
  provider: Provider
  model: string
}

const readJSON = (val?: string) => {
  if (!val) return null
  try {
    return JSON.parse(val)
  } catch {
    return null
  }
}

// Function to read MODELS_JSON from .env file for server-side usage
const readModelsJsonFromFile = (): string => {
  // Check if we're running in a server environment (Node.js)
  if (typeof window === 'undefined' && typeof process !== 'undefined') {
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

          return value
        }
      }
    } catch (error) {
      // Fall back to process.env if file reading fails
      return (process.env.MODELS_JSON || '').trim()
    }
  }

  // Client-side: use import.meta.env
  return (import.meta.env.MODELS_JSON || import.meta.env.AI_MODELS || '').trim()
}

export const loadModelsFromEnv = (): ModelConfig[] => {
  const list: ModelConfig[] = []

  // Get MODELS_JSON from appropriate source (file on server, import.meta.env on client)
  const json = readModelsJsonFromFile()
  const parsed = readJSON(json)
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

  // Back-compat single provider envs (merge when MODELS_JSON exists)
  const getEnvVar = (key: string): string => {
    if (typeof window === 'undefined' && typeof process !== 'undefined') {
      return (process.env[key] || '').trim()
    }
    return ((import.meta.env as any)[key] || '').trim()
  }

  const aiProvider = getEnvVar('AI_PROVIDER').toLowerCase()

  // OpenAI
  const openaiKey = getEnvVar('OPENAI_API_KEY') || getEnvVar('OPENAI_APIKEY')
  const openaiModel = getEnvVar('OPENAI_MODEL_NAME') || getEnvVar('OPENAI_MODEL')
  const openaiBase = getEnvVar('OPENAI_BASE_URL') || getEnvVar('OPENAI_API_BASE') || getEnvVar('OPENAI_API_HOST') || getEnvVar('OPENAI_API_URL')
  const openaiTemp = Number(getEnvVar('OPENAI_TEMPERATURE') || 0.7)
  if (openaiKey && openaiModel) {
    list.push({ id: 'openai_env', label: 'OpenAI (ENV)', provider: 'openai', model: openaiModel, baseUrl: openaiBase || undefined, apiKey: openaiKey, temperature: openaiTemp })
  }

  // Gemini
  const geminiKey = getEnvVar('GEMINI_API_KEY')
  const geminiBase = getEnvVar('API_BASE_URL')
  const geminiModel = getEnvVar('GEMINI_MODEL_NAME') || 'gemini-2.5-flash'
  if (geminiKey) {
    list.push({ id: 'gemini_env', label: 'Gemini (ENV)', provider: 'gemini', model: geminiModel, baseUrl: geminiBase || undefined, apiKey: geminiKey })
  }

  return list
}

export const publicModels = (configs: ModelConfig[]): PublicModelOption[] =>
  configs.map(m => ({ id: m.id, label: m.label || `${m.provider}:${m.model}`, provider: m.provider, model: m.model }))

export const pickDefaultModelId = (configs: ModelConfig[]): string | null => {
  if (!configs.length) return null

  const getEnvVar = (key: string): string => {
    if (typeof window === 'undefined' && typeof process !== 'undefined') {
      return (process.env[key] || '').trim()
    }
    return ((import.meta.env as any)[key] || '').trim()
  }

  const providerPref = getEnvVar('AI_PROVIDER').toLowerCase()
  // If AI_PROVIDER is set, pick first model matching provider
  if (providerPref === 'openai' || providerPref === 'gemini') {
    const found = configs.find(m => m.provider === providerPref)
    if (found) return found.id
  }
  // Optional explicit default
  const explicit = getEnvVar('DEFAULT_MODEL_ID')
  if (explicit) {
    const match = configs.find(m => m.id === explicit)
    if (match) return match.id
  }
  return configs[0].id
}

export const getModelById = (configs: ModelConfig[], id?: string | null): ModelConfig | null => {
  if (!configs.length) return null
  if (!id) return configs.find(m => m.id === pickDefaultModelId(configs)) || configs[0]
  return configs.find(m => m.id === id) || null
}
