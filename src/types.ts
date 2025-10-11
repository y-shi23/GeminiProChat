export interface ChatPart {
  text?: string
  image?: {
    url: string
    name: string
    size: number
    type: string
  }
}

export interface ChatMessage {
  role: 'model' | 'user'
  parts: ChatPart[]
}

export interface ErrorMessage {
  code: string
  message: string
}

export interface ChatSession {
  id: string
  title: string
  messages: ChatMessage[]
  createdAt: number
  updatedAt: number
}

export interface ConversationSession extends ChatSession {
  role: 'assistant' | 'user'
  content: string
}
