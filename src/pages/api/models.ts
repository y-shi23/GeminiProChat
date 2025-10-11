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

// Function to create a clean display name from model info
const createDisplayName = (m: any): string => {
  // If label exists, use it
  if (m.label && m.label.trim()) {
    return String(m.label).trim()
  }

  // If id exists and looks like a display name, use it
  if (m.id && m.id.trim()) {
    const id = String(m.id).trim()
    // If id contains spaces or mixed case, it's likely a display name
    if (id.includes(' ') || (id !== id.toLowerCase() && id !== id.toUpperCase())) {
      return id
    }
    // Convert kebab-case or snake_case to title case
    if (id.includes('-') || id.includes('_')) {
      return id
        .split(/[-_]/)
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ')
    }
  }

  // Use model name as fallback, cleaned up
  if (m.model && m.model.trim()) {
    const model = String(m.model).trim()
    // Remove common prefixes and clean up
    const cleaned = model
      .replace(/^(gpt-|claude-|gemini-)/i, '')
      .replace(/[-_]/g, ' ')
    return cleaned.charAt(0).toUpperCase() + cleaned.slice(1)
  }

  // Final fallback
  return `${m.provider}:${m.model}`
}

const loadModelsFromEnv = (): ModelConfig[] => {
  const list: ModelConfig[] = []

  // Get MODELS_JSON from environment variable (for production deployment like Cloudflare)
  let json = process.env.MODELS_JSON || ''

  // If not in environment, try to read from .env file (for local development)
  if (!json) {
    try {
      const envPath = join(process.cwd(), '.env')
      const envContent = readFileSync(envPath, 'utf8')
      const lines = envContent.split('\n')

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim()
        if (line.startsWith('MODELS_JSON=')) {
          let value = line.slice('MODELS_JSON='.length).trim()

          // Handle multiline JSON values
          if (value.startsWith('[')) {
            const valueLines = [value]
            i++

            // Collect lines until we find the closing bracket
            while (i < lines.length) {
              const nextLine = lines[i]
              valueLines.push(nextLine)
              if (nextLine.trim().endsWith(']')) {
                break
              }
              i++
            }

            value = valueLines.join('\n').trim()

            // Remove any comments or extra content after the closing bracket
            const bracketIndex = value.lastIndexOf(']')
            if (bracketIndex !== -1) {
              value = value.substring(0, bracketIndex + 1)
            }
          }

          json = value
          break
        }
      }
    } catch (error) {
      console.warn('Could not read MODELS_JSON from .env file:', error)
    }
  }

  console.log('Raw MODELS_JSON content:', json || 'undefined')

  const parsed = readJSON(json)
  console.log('Parsed MODELS_JSON:', parsed)

  if (Array.isArray(parsed) && parsed.length) {
    const fromJson: ModelConfig[] = parsed
      .map((m: any) => ({
        id: createDisplayName(m),
        provider: (String(m.provider || '').toLowerCase() as 'openai' | 'gemini'),
        model: String(m.model || ''),
        baseUrl: m.baseUrl ? String(m.baseUrl) : undefined,
        apiKey: m.apiKey ? String(m.apiKey) : undefined,
        temperature: (m.temperature != null ? Number(m.temperature) : undefined),
      }))
      .filter(m => (m.provider === 'openai' || m.provider === 'gemini') && m.model)

    console.log('Processed models:', fromJson)
    list.push(...fromJson)
  }

  if (list.length === 0) {
    console.error('No valid models found. Original parsed data:', parsed)
    console.error('Environment MODELS_JSON:', process.env.MODELS_JSON || 'undefined')
    console.error('Environment variables available:', Object.keys(process.env).filter(key => key.includes('MODEL') || key.includes('API')))
    throw new Error('No models configured. Please set MODELS_JSON environment variable in your Cloudflare Pages settings.')
  }

  return list
}

const publicModels = (configs: ModelConfig[]) =>
  configs.map(m => ({ id: m.id, provider: m.provider, model: m.model }))

const pickDefaultModelId = (configs: ModelConfig[]): string | null => {
  if (!configs.length) return null
  // Return first model as default
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
