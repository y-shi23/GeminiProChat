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

  // Merge single-provider envs
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

const publicModels = (configs: ModelConfig[]) =>
  configs.map(m => ({ id: m.id, label: m.label || `${m.provider}:${m.model}`, provider: m.provider, model: m.model }))

const pickDefaultModelId = (env: Record<string, string | undefined>, configs: ModelConfig[]): string | null => {
  if (!configs.length) return null
  const providerPref = (env.AI_PROVIDER || '').toLowerCase()
  if (providerPref === 'openai' || providerPref === 'gemini') {
    const found = configs.find(m => m.provider === providerPref)
    if (found) return found.id
  }
  const explicit = (env.DEFAULT_MODEL_ID || '').trim()
  if (explicit) {
    const match = configs.find(m => m.id === explicit)
    if (match) return match.id
  }
  return configs[0].id
}

export const onRequestGet = async ({ env }: any) => {
  const configs = loadModelsFromEnv(env as any)
  const items = publicModels(configs)
  const def = pickDefaultModelId(env as any, configs)
  return new Response(JSON.stringify({ models: items, defaultModelId: def }), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
  })
}
