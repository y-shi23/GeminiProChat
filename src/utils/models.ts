import type { ChatMessage } from '@/types'
import { readFileSync } from 'fs'
import { join } from 'path'

export type Provider = 'openai' | 'gemini'

export interface ModelConfig {
  id: string
  provider: Provider
  model: string
  baseUrl?: string
  apiKey?: string
  temperature?: number
}

export interface PublicModelOption {
  id: string
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

export const loadModelsFromEnv = (): ModelConfig[] => {
  const list: ModelConfig[] = []

  // Get MODELS_JSON from appropriate source (file on server, import.meta.env on client)
  const json = readModelsJsonFromFile()
  const parsed = readJSON(json)
  if (Array.isArray(parsed) && parsed.length) {
    const fromJson: ModelConfig[] = parsed
      .map((m: any) => ({
        id: createDisplayName(m),
        provider: (String(m.provider || '').toLowerCase() as Provider),
        model: String(m.model || ''),
        baseUrl: m.baseUrl ? String(m.baseUrl) : undefined,
        apiKey: m.apiKey ? String(m.apiKey) : undefined,
        temperature: (m.temperature != null ? Number(m.temperature) : undefined),
      }))
      .filter(m => (m.provider === 'openai' || m.provider === 'gemini') && m.model)
    list.push(...fromJson)
  }

  if (list.length === 0) {
    throw new Error('No models configured. Please set MODELS_JSON environment variable.')
  }

  return list
}

export const publicModels = (configs: ModelConfig[]): PublicModelOption[] =>
  configs.map(m => ({ id: m.id, provider: m.provider, model: m.model }))

export const pickDefaultModelId = (configs: ModelConfig[]): string | null => {
  if (!configs.length) return null

  // Return first model as default
  return configs[0].id
}

export const getModelById = (configs: ModelConfig[], id?: string | null): ModelConfig | null => {
  if (!configs.length) return null
  if (!id) return configs.find(m => m.id === pickDefaultModelId(configs)) || configs[0]
  return configs.find(m => m.id === id) || null
}

