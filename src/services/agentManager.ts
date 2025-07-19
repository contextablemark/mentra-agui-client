import { v4 as uuidv4 } from 'uuid';
import { RunAgentInputSchema, Agent, AgentEvent } from '@ag-ui/core';
import { AppSession } from '@mentra/sdk';

export interface AgentConfig {
  backendAgent: Agent;
  stateful?: boolean;
}

export interface SessionAgent {
  agent: Agent;
  sessionId: string;
  userId: string;
  messages: Array<{ id: string; role: string; content: string }>;
  currentRunSubscription?: any; // Subscription from agent.run()
  isInterrupted: boolean;
}

export class AgentManager {
  private sessionAgents: Map<string, SessionAgent> = new Map();
  private config: AgentConfig;

  constructor(config: AgentConfig) {
    this.config = {
      ...config,
      stateful: config.stateful !== false // Default to true
    };
  }

  /**
   * Create or get an agent session for a user
   */
  createSession(sessionId: string, userId: string): SessionAgent {
    // Check if session already exists
    if (this.sessionAgents.has(sessionId)) {
      return this.sessionAgents.get(sessionId)!;
    }

    // Clone the backend agent for this session
    let agent: Agent;
    if (this.config.backendAgent.clone) {
      agent = this.config.backendAgent.clone();
    } else {
      // Fallback if clone isn't implemented
      agent = Object.create(this.config.backendAgent);
    }

    // Create new session
    const sessionAgent: SessionAgent = {
      agent,
      sessionId,
      userId,
      messages: [],
      isInterrupted: false
    };

    // Set threadId to sessionId to maintain conversation context
    agent.threadId = sessionId;

    this.sessionAgents.set(sessionId, sessionAgent);
    return sessionAgent;
  }

  /**
   * Process a transcription and run the agent
   */
  async processTranscription(
    sessionId: string,
    transcription: string,
    onEvent: (event: AgentEvent) => void
  ): Promise<void> {
    const sessionAgent = this.sessionAgents.get(sessionId);
    if (!sessionAgent) {
      throw new Error(`No session found for sessionId: ${sessionId}`);
    }

    // Reset interruption flag
    sessionAgent.isInterrupted = false;

    // Create user message
    const userMessage = {
      id: uuidv4(),
      role: 'user',
      content: transcription
    };

    // Prepare messages based on stateful/stateless mode
    let messagesToSend;
    if (this.config.stateful) {
      // Stateful: maintain full conversation history
      sessionAgent.messages.push(userMessage);
      messagesToSend = sessionAgent.messages;
    } else {
      // Stateless: only send current message
      messagesToSend = [userMessage];
    }

    try {
      // Prepare input for agent
      const runAgentInput = RunAgentInputSchema.parse({
        threadId: sessionAgent.agent.threadId || sessionId,
        runId: uuidv4(),
        messages: messagesToSend,
        state: {},
        tools: [],
        context: [],
        forwardedProps: {}
      });

      // Reset abort controller if agent supports it
      if (sessionAgent.agent.abortController) {
        sessionAgent.agent.abortController = new AbortController();
      }

      // Cancel any existing subscription
      if (sessionAgent.currentRunSubscription) {
        sessionAgent.currentRunSubscription.unsubscribe();
      }

      // Subscribe to agent's event stream
      sessionAgent.currentRunSubscription = sessionAgent.agent.run(runAgentInput).subscribe({
        next: (event) => {
          if (!sessionAgent.isInterrupted) {
            onEvent(event);
          }
        },
        error: (err) => {
          console.error('Agent runtime error:', err);
          onEvent({
            type: 'ERROR',
            error: err.message || 'Unknown error occurred'
          } as any);
        },
        complete: () => {
          console.log('Agent run completed');
        }
      });
    } catch (err) {
      console.error('Failed to run agent:', err);
      throw err;
    }
  }

  /**
   * Handle interruption of current agent run
   */
  interruptSession(sessionId: string): void {
    const sessionAgent = this.sessionAgents.get(sessionId);
    if (!sessionAgent) {
      return;
    }

    sessionAgent.isInterrupted = true;

    // Try to abort the current run if the agent supports it
    if (sessionAgent.agent && sessionAgent.agent.abortRun) {
      try {
        if (sessionAgent.agent.abortController && 
            typeof sessionAgent.agent.abortController.abort === 'function') {
          sessionAgent.agent.abortRun();
        }
      } catch (error) {
        console.warn('Failed to abort agent run:', error);
      }
    }

    // Cancel the subscription
    if (sessionAgent.currentRunSubscription) {
      sessionAgent.currentRunSubscription.unsubscribe();
      sessionAgent.currentRunSubscription = undefined;
    }
  }

  /**
   * Clean up a session
   */
  removeSession(sessionId: string): void {
    const sessionAgent = this.sessionAgents.get(sessionId);
    if (sessionAgent) {
      // Cancel any active subscriptions
      if (sessionAgent.currentRunSubscription) {
        sessionAgent.currentRunSubscription.unsubscribe();
      }
      
      this.sessionAgents.delete(sessionId);
    }
  }

  /**
   * Get session by ID
   */
  getSession(sessionId: string): SessionAgent | undefined {
    return this.sessionAgents.get(sessionId);
  }

  /**
   * Update session with assistant message (for stateful mode)
   */
  addAssistantMessage(sessionId: string, messageId: string, content: string): void {
    if (!this.config.stateful) return;

    const sessionAgent = this.sessionAgents.get(sessionId);
    if (sessionAgent) {
      sessionAgent.messages.push({
        id: messageId,
        role: 'assistant',
        content
      });
    }
  }
}