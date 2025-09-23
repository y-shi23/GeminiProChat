import type { ChatSession, ChatMessage } from '@/types'

export const generateSessionId = (): string => {
  return Date.now().toString(36) + Math.random().toString(36).substr(2)
}

export const generateSessionTitle = (messages: ChatMessage[]): string => {
  if (messages.length === 0) return 'New Chat'

  const firstUserMessage = messages.find(msg => msg.role === 'user')
  if (!firstUserMessage) return 'New Chat'

  const content = firstUserMessage.parts.map(part => part.text).join(' ')
  // Truncate to first 30 characters for title
  return content.length > 30 ? content.substring(0, 30) + '...' : content
}

export const loadSessions = (): ChatSession[] => {
  try {
    const stored = localStorage.getItem('chatSessions')
    if (!stored) return []

    const sessions = JSON.parse(stored) as ChatSession[]
    // Sort by updatedAt descending (most recent first)
    return sessions.sort((a, b) => b.updatedAt - a.updatedAt)
  } catch (error) {
    console.error('Failed to load sessions:', error)
    return []
  }
}

export const saveSessions = (sessions: ChatSession[]): void => {
  try {
    localStorage.setItem('chatSessions', JSON.stringify(sessions))
  } catch (error) {
    console.error('Failed to save sessions:', error)
  }
}

export const createNewSession = (): ChatSession => {
  return {
    id: generateSessionId(),
    title: 'New Chat',
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

export const updateSession = (
  sessions: ChatSession[],
  sessionId: string,
  updates: Partial<ChatSession>
): ChatSession[] => {
  return sessions.map(session =>
    session.id === sessionId
      ? { ...session, ...updates, updatedAt: Date.now() }
      : session
  )
}

export const deleteSession = (sessions: ChatSession[], sessionId: string): ChatSession[] => {
  return sessions.filter(session => session.id !== sessionId)
}

// Migration helper: convert old single conversation to first session
export const migrateLegacyData = (): ChatSession | null => {
  try {
    const oldMessages = localStorage.getItem('messageList')
    if (!oldMessages) return null

    const messages = JSON.parse(oldMessages) as any[]
    if (!messages || messages.length === 0) return null

    // Convert old format to new format
    const convertedMessages: ChatMessage[] = messages.map(msg => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }]
    }))

    const session: ChatSession = {
      id: generateSessionId(),
      title: generateSessionTitle(convertedMessages),
      messages: convertedMessages,
      createdAt: Date.now() - 1000, // Slightly older to appear as imported
      updatedAt: Date.now() - 1000,
    }

    // Clear old data
    localStorage.removeItem('messageList')

    return session
  } catch (error) {
    console.error('Failed to migrate legacy data:', error)
    return null
  }
}