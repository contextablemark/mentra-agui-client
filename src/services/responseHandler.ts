import { AgentEvent } from '@ag-ui/core';
import { AppSession } from '@mentra/sdk';
import { AgentManager } from './agentManager';
import { logger } from '../utils/logger';

export class ResponseHandler {
  private agentManager: AgentManager;
  private currentMessages: Map<string, { id: string; content: string }> = new Map();

  constructor(agentManager: AgentManager) {
    this.agentManager = agentManager;
  }

  /**
   * Handle agent events and display responses in MentraOS
   */
  handleAgentEvent(event: AgentEvent, session: AppSession, sessionId: string): void {
    switch (event.type) {
      case 'TEXT_MESSAGE_START':
        // Initialize tracking for the new message
        logger.debug('Agent starting response', {
          sessionId,
          messageId: event.messageId
        });
        this.currentMessages.set(sessionId, {
          id: event.messageId,
          content: ''
        });
        break;

      case 'TEXT_MESSAGE_CONTENT':
        // Stream content to MentraOS display
        const current = this.currentMessages.get(sessionId);
        if (current) {
          current.content += event.delta;
          logger.debug('Agent response chunk', {
            sessionId,
            delta: event.delta,
            totalLength: current.content.length
          });
          // Display the delta on the glasses
          session.layouts.showTextWall(event.delta);
        }
        break;

      case 'TEXT_MESSAGE_END':
        // Message complete
        const message = this.currentMessages.get(sessionId);
        if (message && message.id && message.content) {
          logger.info('Agent response complete', {
            sessionId,
            messageId: message.id,
            fullResponse: message.content,
            responseLength: message.content.length
          });
          
          // Update agent's message history with the complete response
          this.agentManager.addAssistantMessage(sessionId, message.id, message.content);
          
          // Clean up tracking
          this.currentMessages.delete(sessionId);
        }
        break;

      case 'TOOL_CALL_START':
        // Optionally show tool usage to user
        logger.debug('Tool call started', {
          sessionId,
          toolName: event.toolCallName,
          toolCallId: event.toolCallId
        });
        // Could display: session.layouts.showTextWall(`Using ${event.toolCallName}...`);
        break;

      case 'TOOL_CALL_END':
        logger.debug('Tool call completed', {
          sessionId,
          toolCallId: event.toolCallId
        });
        break;

      case 'ERROR':
        // Display error to user
        logger.error('Agent error event', {
          sessionId,
          error: event
        });
        session.layouts.showTextWall('Sorry, I encountered an error processing your request.');
        break;

      // State events are handled by the backend
      case 'STATE_SNAPSHOT':
      case 'STATE_DELTA':
        logger.debug('State update event (ignored)', {
          sessionId,
          eventType: event.type
        });
        break;

      default:
        logger.warn('Unhandled event type', {
          sessionId,
          eventType: event.type,
          event
        });
    }
  }

  /**
   * Clean up any tracking for a session
   */
  cleanupSession(sessionId: string): void {
    this.currentMessages.delete(sessionId);
  }
}