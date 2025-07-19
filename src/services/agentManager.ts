import { v4 as uuidv4 } from 'uuid';
import { RunAgentInputSchema, Agent, AgentEvent } from '@ag-ui/core';
import { AppSession } from '@mentra/sdk';
import { logger } from '../utils/logger';

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

    // Use the shared backend agent instance for this session
    // Following TwilioAgent pattern: HttpAgent doesn't support cloning,
    // so we share the instance but use unique threadIds for conversation separation
    const agent = this.config.backendAgent;

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
      
      logger.debug('Sending request to agent', {
        sessionId,
        threadId: runAgentInput.threadId,
        runId: runAgentInput.runId,
        messageCount: messagesToSend.length,
        lastMessage: messagesToSend[messagesToSend.length - 1]
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
          logger.debug('Received agent event', {
            sessionId,
            eventType: event.type,
            event: event
          });
          
          if (!sessionAgent.isInterrupted) {
            onEvent(event);
          }
        },
        error: (err) => {
          logger.error('Agent runtime error:', {
            sessionId,
            error: err.message || err,
            stack: err.stack
          });
          onEvent({
            type: 'ERROR',
            error: err.message || 'Unknown error occurred'
          } as any);
        },
        complete: () => {
          logger.info('Agent run completed', { sessionId });
        }
      });
    } catch (err) {
      logger.error('Failed to run agent:', {
        sessionId,
        error: err.message || err,
        stack: err.stack
      });
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
        logger.warn('Failed to abort agent run:', error);
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