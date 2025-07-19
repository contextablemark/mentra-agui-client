import { AgentEvent } from '@ag-ui/core';
import { AppSession } from '@mentra/sdk';
import { AgentManager } from './agentManager';

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
          // Display the delta on the glasses
          session.layouts.showTextWall(event.delta);
        }
        break;

      case 'TEXT_MESSAGE_END':
        // Message complete
        const message = this.currentMessages.get(sessionId);
        if (message && message.id && message.content) {
          // Update agent's message history with the complete response
          this.agentManager.addAssistantMessage(sessionId, message.id, message.content);
          
          // Clean up tracking
          this.currentMessages.delete(sessionId);
        }
        break;

      case 'TOOL_CALL_START':
        // Optionally show tool usage to user
        console.log(`Tool ${event.toolCallName} started for session ${sessionId}`);
        // Could display: session.layouts.showTextWall(`Using ${event.toolCallName}...`);
        break;

      case 'TOOL_CALL_END':
        console.log(`Tool call completed for session ${sessionId}`);
        break;

      case 'ERROR':
        // Display error to user
        session.layouts.showTextWall('Sorry, I encountered an error processing your request.');
        console.error('Agent error:', event);
        break;

      // State events are handled by the backend
      case 'STATE_SNAPSHOT':
      case 'STATE_DELTA':
        break;

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }
  }

  /**
   * Clean up any tracking for a session
   */
  cleanupSession(sessionId: string): void {
    this.currentMessages.delete(sessionId);
  }
}