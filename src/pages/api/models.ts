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

  // Load .env file manually for server-side API routes
  const envVars: Record<string, string> = {}
  try {
    const envPath = join(process.cwd(), '.env')
    const envContent = readFileSync(envPath, 'utf8')
    const lines = envContent.split('\n')

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue

      const equalIndex = trimmed.indexOf('=')
      if (equalIndex === -1) continue

      const key = trimmed.slice(0, equalIndex).trim()
      const value = trimmed.slice(equalIndex + 1).trim()
      envVars[key] = value
    }
  } catch (error) {
    console.warn('Could not load .env file:', error)
  }

  // Combine with process.env, giving priority to .env file
  const getEnvVar = (key: string): string => {
    return envVars[key] || process.env[key] || ''
  }

  // Read MODELS_JSON from .env
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
    console.warn('Could not read MODELS_JSON from .env file:', error)
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
  const openaiKey = (getEnvVar('OPENAI_API_KEY') || getEnvVar('OPENAI_APIKEY')).trim()
  const openaiModel = (getEnvVar('OPENAI_MODEL_NAME') || getEnvVar('OPENAI_MODEL')).trim()
  const openaiBase = (getEnvVar('OPENAI_BASE_URL') || getEnvVar('OPENAI_API_BASE') || getEnvVar('OPENAI_API_HOST') || getEnvVar('OPENAI_API_URL')).trim()
  const openaiTemp = Number(getEnvVar('OPENAI_TEMPERATURE') || 0.7)

  if (openaiKey && openaiModel) {
    list.push({ id: 'openai_env', label: 'OpenAI (ENV)', provider: 'openai', model: openaiModel, baseUrl: openaiBase || undefined, apiKey: openaiKey, temperature: openaiTemp })
  }

  // Gemini
  const geminiKey = getEnvVar('GEMINI_API_KEY').trim()
  const geminiBase = getEnvVar('API_BASE_URL').trim()
  const geminiModel = (getEnvVar('GEMINI_MODEL_NAME') || 'gemini-2.5-flash').trim()
  if (geminiKey) {
    list.push({ id: 'gemini_env', label: 'Gemini (ENV)', provider: 'gemini', model: geminiModel, baseUrl: geminiBase || undefined, apiKey: geminiKey })
  }

  return list
}

const publicModels = (configs: ModelConfig[]) =>
  configs.map(m => ({ id: m.id, label: m.label || `${m.provider}:${m.model}`, provider: m.provider, model: m.model }))

const pickDefaultModelId = (configs: ModelConfig[]): string | null => {
  if (!configs.length) return null
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
