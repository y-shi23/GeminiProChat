import type { ChatMessage } from '@/types'

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

export const loadModelsFromEnv = (): ModelConfig[] => {
  const list: ModelConfig[] = []

  // Prefer unified JSON config for multiple models; we will MERGE with legacy envs if present
  const json = (import.meta.env.MODELS_JSON || import.meta.env.AI_MODELS || '').trim()
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
  const aiProvider = (import.meta.env.AI_PROVIDER || '').toLowerCase()

  // OpenAI
  const openaiKey = (import.meta.env.OPENAI_API_KEY || import.meta.env.OPENAI_APIKEY || '').trim()
  const openaiModel = (import.meta.env.OPENAI_MODEL_NAME || import.meta.env.OPENAI_MODEL || '').trim()
  const openaiBase = (import.meta.env.OPENAI_BASE_URL || import.meta.env.OPENAI_API_BASE || import.meta.env.OPENAI_API_HOST || import.meta.env.OPENAI_API_URL || '').trim()
  const openaiTemp = Number(import.meta.env.OPENAI_TEMPERATURE || 0.7)
  if (openaiKey && openaiModel) {
    list.push({ id: 'openai_env', label: 'OpenAI (ENV)', provider: 'openai', model: openaiModel, baseUrl: openaiBase || undefined, apiKey: openaiKey, temperature: openaiTemp })
  }

  // Gemini
  const geminiKey = (import.meta.env.GEMINI_API_KEY || '').trim()
  const geminiBase = (import.meta.env.API_BASE_URL || '').trim()
  const geminiModel = (import.meta.env.GEMINI_MODEL_NAME || 'gemini-2.5-flash').trim()
  if (geminiKey) {
    list.push({ id: 'gemini_env', label: 'Gemini (ENV)', provider: 'gemini', model: geminiModel, baseUrl: geminiBase || undefined, apiKey: geminiKey })
  }

  return list
}

export const publicModels = (configs: ModelConfig[]): PublicModelOption[] =>
  configs.map(m => ({ id: m.id, label: m.label || `${m.provider}:${m.model}`, provider: m.provider, model: m.model }))

export const pickDefaultModelId = (configs: ModelConfig[]): string | null => {
  if (!configs.length) return null
  const providerPref = (import.meta.env.AI_PROVIDER || '').toLowerCase()
  // If AI_PROVIDER is set, pick first model matching provider
  if (providerPref === 'openai' || providerPref === 'gemini') {
    const found = configs.find(m => m.provider === providerPref)
    if (found) return found.id
  }
  // Optional explicit default
  const explicit = (import.meta.env.DEFAULT_MODEL_ID || '').trim()
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
