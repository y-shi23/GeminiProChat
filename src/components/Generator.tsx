import { Index, Show, createEffect, createSignal, onCleanup, onMount, batch } from 'solid-js'
import { useThrottleFn } from 'solidjs-use'
import { generateSignature } from '@/utils/auth'
import {
  loadSessions,
  saveSessions,
  createNewSession,
  updateSession,
  deleteSession,
  generateSessionTitle,
  migrateLegacyData
} from '@/utils/sessions'
import IconClear from './icons/Clear'
import IconSend from './icons/Send'
import IconX from './icons/X'
import MessageItem from './MessageItem'
import ErrorMessageItem from './ErrorMessageItem'
import Sidebar from './Sidebar'
import type { ChatMessage, ErrorMessage, ChatSession } from '@/types'

export default () => {
  let inputRef: HTMLTextAreaElement

  // Session management
  const [sessions, setSessions] = createSignal<ChatSession[]>([])
  const [currentSessionId, setCurrentSessionId] = createSignal<string | null>(null)

  // Current session state
  const [messageList, setMessageList] = createSignal<ChatMessage[]>([])
  const [currentError, setCurrentError] = createSignal<ErrorMessage>()
  const [currentAssistantMessage, setCurrentAssistantMessage] = createSignal('')
  const [loading, setLoading] = createSignal(false)
  const [controller, setController] = createSignal<AbortController>(null)

  // Auto-scroll to bottom when streaming; disables when user scrolls up
  const [isStick, setStick] = createSignal(true)
  const maxHistoryMessages = parseInt(import.meta.env.PUBLIC_MAX_HISTORY_MESSAGES || '99')

  createEffect(() => (isStick() && smoothToBottom()))

  // Get current session
  const getCurrentSession = (): ChatSession | null => {
    const sessionId = currentSessionId()
    return sessionId ? sessions().find(s => s.id === sessionId) || null : null
  }

  // Save current session
  const saveCurrentSession = () => {
    const sessionId = currentSessionId()
    if (!sessionId) return

    const currentMessages = messageList()
    const title = generateSessionTitle(currentMessages)

    const updatedSessions = updateSession(sessions(), sessionId, {
      messages: currentMessages,
      title
    })

    setSessions(updatedSessions)
    saveSessions(updatedSessions)
  }

  // Switch to a session
  const switchToSession = (sessionId: string) => {
    console.log('switchToSession called with:', sessionId)

    // Save current session before switching (but don't update sessions state yet)
    let currentSessions = sessions()
    if (currentSessionId()) {
      const currentMessages = messageList()
      const title = generateSessionTitle(currentMessages)

      currentSessions = updateSession(currentSessions, currentSessionId()!, {
        messages: currentMessages,
        title
      })
    }

    const session = currentSessions.find(s => s.id === sessionId)
    console.log('Found session:', session)

    if (session) {
      console.log('Session messages:', session.messages)

      // Use batch to ensure all state updates happen atomically
      batch(() => {
        // Update sessions state after we've found the target session
        setSessions(currentSessions)

        // Clear current state first
        setCurrentError(null)
        setCurrentAssistantMessage('')
        setLoading(false)

        // Clear any ongoing requests
        if (controller()) {
          controller().abort()
          setController(null)
        }

        // Set new session data
        setCurrentSessionId(sessionId)

        // Force a completely new array to ensure reactivity
        const newMessages = session.messages.map(msg => ({...msg}))
        setMessageList(newMessages)
        setStick(true)

        console.log('Batch update completed - Message list:', newMessages)
        console.log('Batch update completed - Session ID:', sessionId)
      })

      // Save to localStorage after state updates
      saveSessions(currentSessions)

      // Delayed verification
      setTimeout(() => {
        console.log('Delayed check - messageList():', messageList())
        console.log('Delayed check - currentSessionId():', currentSessionId())
      }, 100)
    } else {
      console.error('Session not found:', sessionId)
    }
  }

  // Create new session
  const createSession = () => {
    // Save current session first (but don't update state yet)
    let currentSessions = sessions()
    if (currentSessionId()) {
      const currentMessages = messageList()
      const title = generateSessionTitle(currentMessages)

      currentSessions = updateSession(currentSessions, currentSessionId()!, {
        messages: currentMessages,
        title
      })
    }

    const newSession = createNewSession()
    const updatedSessions = [newSession, ...currentSessions]

    // Use batch for atomic state updates
    batch(() => {
      setSessions(updatedSessions)

      // Switch to new session
      setCurrentSessionId(newSession.id)
      setMessageList([])
      setCurrentError(null)
      setCurrentAssistantMessage('')
      setStick(true)
    })

    saveSessions(updatedSessions)

    // Focus input
    setTimeout(() => {
      if (inputRef && !('ontouchstart' in document.documentElement || navigator.maxTouchPoints > 0)) {
        inputRef.focus()
      }
    }, 100)
  }

  // Delete session
  const handleDeleteSession = (sessionId: string) => {
    const updatedSessions = deleteSession(sessions(), sessionId)

    // Use batch for atomic updates
    batch(() => {
      setSessions(updatedSessions)

      // If deleting current session, switch to another or create new
      if (sessionId === currentSessionId()) {
        if (updatedSessions.length > 0) {
          // Don't call switchToSession here as it will try to save the current session again
          const firstSession = updatedSessions[0]
          setCurrentSessionId(firstSession.id)
          setMessageList([...firstSession.messages])
          setCurrentError(null)
          setCurrentAssistantMessage('')
          setStick(true)
        } else {
          // Will create new session outside batch
        }
      }
    })

    saveSessions(updatedSessions)

    // Create new session if no sessions left (outside batch to avoid conflicts)
    if (sessionId === currentSessionId() && updatedSessions.length === 0) {
      createSession()
    }
  }

  onMount(() => {
    let lastPostion = window.scrollY

    window.addEventListener('scroll', () => {
      const nowPostion = window.scrollY
      // If user scrolls up, disable stick
      if (nowPostion < lastPostion)
        setStick(false)

      // If user scrolls down and is near bottom, re-enable stick
      // More precise bottom detection
      const nearBottom = (window.innerHeight + window.scrollY) >= (document.body.scrollHeight - 50)
      if (nowPostion >= lastPostion && nearBottom)
        setStick(true)

      lastPostion = nowPostion
    })

    // Initialize sessions
    try {
      let loadedSessions = loadSessions()

      // Check for legacy data migration
      const legacySession = migrateLegacyData()
      if (legacySession) {
        loadedSessions = [legacySession, ...loadedSessions]
        saveSessions(loadedSessions)
      }

      if (loadedSessions.length > 0) {
        setSessions(loadedSessions)
        switchToSession(loadedSessions[0].id)
      } else {
        // Create first session
        createSession()
      }

      if (localStorage.getItem('stickToBottom') === 'stick')
        setStick(true)
    } catch (err) {
      console.error('Error during initialization:', err)
      // Fallback: create new session
      createSession()
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    onCleanup(() => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
    })
  })

  const handleBeforeUnload = () => {
    // Save current session before unload
    if (currentSessionId()) {
      saveCurrentSession()
    }
    isStick() ? localStorage.setItem('stickToBottom', 'stick') : localStorage.removeItem('stickToBottom')
  }

  const handleButtonClick = async() => {
    const inputValue = inputRef.value
    if (!inputValue)
      return

    inputRef.value = ''

    const newMessage: ChatMessage = {
      role: 'user',
      parts: [{ text: inputValue }],
    }

    const updatedMessages = [...messageList(), newMessage]
    setMessageList(updatedMessages)
    // Persist session title and messages promptly for correctness
    saveCurrentSession()

    // Enable stick when user sends a message to ensure they see the response
    setStick(true)
    requestWithLatestMessage()
    // Ensure we start at the bottom when sending
    smoothToBottom()
  }

  const smoothToBottom = useThrottleFn(() => {
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' })
  }, 100, false, true)

  const instantToBottom = () => {
    // Use standard behavior value 'auto' for immediate jump
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'auto' })
  }

  // ? Interim Solution
  // ensure that the user and the model have a one-to-one conversation and avoid any errors like:
  // "Please ensure that multiturn requests ends with a user role or a function response."
  // convert the raw list into data that conforms to the interface api rules
  const convertReqMsgList = (originalMsgList: ChatMessage[]) => {
    return originalMsgList.filter((curMsg, i, arr) => {
      // Check if there is a next message
      const nextMsg = arr[i + 1]
      // Include the current message if there is no next message or if the roles are different
      return !nextMsg || curMsg.role !== nextMsg.role
    })
  }

  const requestWithLatestMessage = async() => {
    setLoading(true)
    setCurrentAssistantMessage('')
    setCurrentError(null)
    const storagePassword = localStorage.getItem('pass')
    try {
      const controller = new AbortController()
      setController(controller)
      const requestMessageList = messageList().map(message => ({
        role: message.role === 'user' ? 'user' : 'model',
        parts: message.parts,
      })).slice(-maxHistoryMessages)
      const timestamp = Date.now()
      const response = await fetch('/api/generate', {
        method: 'POST',
        body: JSON.stringify({
          messages: convertReqMsgList(requestMessageList),
          time: timestamp,
          pass: storagePassword,
          sign: await generateSignature({
            t: timestamp,
            m: requestMessageList?.[requestMessageList.length - 1]?.parts[0]?.text || '',
          }),
        }),
        signal: controller.signal,
      })
      if (!response.ok) {
        const error = await response.json()
        console.error(error.error)
        setCurrentError(error.error)
        throw new Error('Request failed')
      }
      const data = response.body
      if (!data)
        throw new Error('No data')

      const reader = data.getReader()
      const decoder = new TextDecoder('utf-8')
      let done = false

      while (!done) {
        const { value, done: readerDone } = await reader.read()
        if (value) {
          const char = decoder.decode(value, { stream: true })
          if (char === '\n' && currentAssistantMessage().endsWith('\n'))
            continue

          if (char) {
            setCurrentAssistantMessage(currentAssistantMessage() + char)
            // Smoothly follow the stream when stick is enabled - more responsive
            if (isStick()) smoothToBottom()
          }
        }
        done = readerDone
      }
      if (done)
        setCurrentAssistantMessage(currentAssistantMessage() + decoder.decode())
    } catch (e) {
      console.error(e)
      setLoading(false)
      setController(null)
      return
    }
    archiveCurrentMessage()
    if (isStick()) smoothToBottom()
  }

  const archiveCurrentMessage = () => {
    if (currentAssistantMessage()) {
      const assistantMessage: ChatMessage = {
        role: 'model',
        parts: [{ text: currentAssistantMessage() }],
      }

      const updatedMessages = [...messageList(), assistantMessage]
      setMessageList(updatedMessages)
      setCurrentAssistantMessage('')
      setLoading(false)
      setController(null)

      // Persist to sessions so refresh reflects latest state
      saveCurrentSession()

      // Ensure we scroll to bottom when message is complete
      if (isStick()) {
        setTimeout(() => smoothToBottom(), 50)
      }

      // Disable auto-focus on touch devices
      if (!('ontouchstart' in document.documentElement || navigator.maxTouchPoints > 0))
        inputRef.focus()
    }
  }

  const clear = () => {
    inputRef.value = ''
    inputRef.style.height = 'auto'
    setMessageList([])
    setCurrentAssistantMessage('')
    setCurrentError(null)
  }

  const stopStreamFetch = () => {
    if (controller()) {
      controller().abort()
      archiveCurrentMessage()
    }
  }

  const retryLastFetch = () => {
    if (messageList().length > 0) {
      const lastMessage = messageList()[messageList().length - 1]
      if (lastMessage.role === 'model')
        setMessageList(messageList().slice(0, -1))
      requestWithLatestMessage()
    }
  }

  const handleKeydown = (e: KeyboardEvent) => {
    if (e.isComposing || e.shiftKey)
      return

    if (e.key === 'Enter') {
      e.preventDefault()
      handleButtonClick()
    }
  }

  return (
    <div my-6>
      {/* Sidebar */}
      <Sidebar
        sessions={sessions()}
        currentSessionId={currentSessionId()}
        onSessionSelect={switchToSession}
        onSessionDelete={handleDeleteSession}
        onNewSession={createSession}
      />

      <Index each={messageList()}>
        {(message, index) => (
          <MessageItem
            role={message().role === 'model' ? 'assistant' : 'user'}
            // Pass accessor to keep reactivity when switching sessions or updating messages
            message={() => message().parts.map(p => p.text).join('')}
            showRetry={() => (message().role === 'model' && index === messageList().length - 1)}
            onRetry={retryLastFetch}
          />
        )}
      </Index>
      {currentAssistantMessage() && (
        <MessageItem
          role="assistant"
          message={currentAssistantMessage}
        />
      )}
      {currentError() && <ErrorMessageItem data={currentError()} onRetry={retryLastFetch} />}

      {/* Fixed input area at bottom when messages exist */}
      <Show when={messageList().length > 0}>
        {/* Background fill between input and footer */}
        <div class="fixed bottom-0 left-0 right-0 h-8 z-5 bg-[var(--c-bg)]"></div>

        <div class="fixed bottom-8 left-0 right-0 z-10 bg-[var(--c-bg)] pt-2 pb-4">
          <div class="max-w-[70ch] mx-auto px-8">
            <Show
              when={!loading()}
              fallback={() => (
                <div class="gen-cb-wrapper">
                  <span>AI is thinking...</span>
                  <div class="gen-cb-stop" onClick={stopStreamFetch}>Stop</div>
                </div>
              )}
            >
              <div class="gen-text-wrapper relative">
                <textarea
                  ref={inputRef!}
                  onKeyDown={handleKeydown}
                  placeholder="Enter something..."
                  autocomplete="off"
                  autofocus
                  onInput={() => {
                    inputRef.style.height = 'auto'
                    inputRef.style.height = `${inputRef.scrollHeight}px`
                  }}
                  rows="1"
                  class="gen-textarea"
                />
                <button onClick={handleButtonClick} gen-slate-btn title="Send">
                  <IconSend />
                </button>
                <button title="Clear" onClick={clear} gen-slate-btn>
                  <IconClear />
                </button>
              </div>
            </Show>
          </div>
        </div>
      </Show>

      {/* Regular input area when no messages */}
      <Show when={messageList().length === 0}>
        <Show
          when={!loading()}
          fallback={() => (
            <div class="gen-cb-wrapper">
              <span>AI is thinking...</span>
              <div class="gen-cb-stop" onClick={stopStreamFetch}>Stop</div>
            </div>
          )}
        >
          <div class="gen-text-wrapper relative">
            <textarea
              ref={inputRef!}
              onKeyDown={handleKeydown}
              placeholder="Enter something..."
              autocomplete="off"
              autofocus
              onInput={() => {
                inputRef.style.height = 'auto'
                inputRef.style.height = `${inputRef.scrollHeight}px`
              }}
              rows="1"
              class="gen-textarea"
            />
            <button onClick={handleButtonClick} gen-slate-btn title="Send">
              <IconSend />
            </button>
            <button title="Clear" onClick={clear} gen-slate-btn>
              <IconClear />
            </button>
          </div>
        </Show>
      </Show>
    </div>
  )
}
