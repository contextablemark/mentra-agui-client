import { ToolCall, AppServer, AppSession } from '@mentra/sdk';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { setupExpressRoutes } from './webview';
import { handleToolCall } from './tools';
import { AgentManager } from './services/agentManager';
import { ResponseHandler } from './services/responseHandler';
import { createBackendAgent } from './config/agentConfig';
import { logger } from './utils/logger';

const PACKAGE_NAME = process.env.PACKAGE_NAME ?? (() => { throw new Error('PACKAGE_NAME is not set in .env file'); })();
const MENTRAOS_API_KEY = process.env.MENTRAOS_API_KEY ?? (() => { throw new Error('MENTRAOS_API_KEY is not set in .env file'); })();
const PORT = parseInt(process.env.PORT || '3000');
const AGENT_STATEFUL = process.env.AGENT_STATEFUL !== 'false'; // Default to true

class ExampleMentraOSApp extends AppServer {
  private agentManager: AgentManager;
  private responseHandler: ResponseHandler;
  private sessionIdMap = new Map<string, string>(); // userId -> sessionId mapping

  constructor() {
    super({
      packageName: PACKAGE_NAME,
      apiKey: MENTRAOS_API_KEY,
      port: PORT,
      publicDir: path.join(__dirname, '../public'),
    });

    // Initialize AgentManager with backend agent
    try {
      const backendAgent = createBackendAgent();
      this.agentManager = new AgentManager({
        backendAgent,
        stateful: AGENT_STATEFUL
      });
      this.responseHandler = new ResponseHandler(this.agentManager);
    } catch (error) {
      logger.error('Failed to initialize backend agent:', error);
      logger.error('Please configure your agent in src/config/agentConfig.ts');
      throw error;
    }

    // Set up Express routes
    setupExpressRoutes(this);
  }

  /** Map to store active user sessions */
  private userSessionsMap = new Map<string, AppSession>();

  /**
   * Handles tool calls from the MentraOS system
   * @param toolCall - The tool call request
   * @returns Promise resolving to the tool call response or undefined
   */
  protected async onToolCall(toolCall: ToolCall): Promise<string | undefined> {
    return handleToolCall(toolCall, toolCall.userId, this.userSessionsMap.get(toolCall.userId));
  }

  /**
   * Handles new user sessions
   * Sets up event listeners and displays welcome message
   * @param session - The app session instance
   * @param sessionId - Unique session identifier
   * @param userId - User identifier
   */
  protected async onSession(session: AppSession, sessionId: string, userId: string): Promise<void> {
    this.userSessionsMap.set(userId, session);

    // Generate unique session ID for this conversation
    const uniqueSessionId = `${userId}-${Date.now()}-${uuidv4()}`;
    this.sessionIdMap.set(userId, uniqueSessionId);

    // Create agent session
    this.agentManager.createSession(uniqueSessionId, userId);

    // Show welcome message
    session.layouts.showTextWall("Connected to assistant");

    // Listen for transcriptions
    session.events.onTranscription(async (data) => {
      if (data.isFinal) {
        logger.debug("Transcript received:", { text: data.text, userId, sessionId: uniqueSessionId });
        
        try {
          // Process transcription through agent
          await this.agentManager.processTranscription(
            uniqueSessionId,
            data.text,
            (event) => {
              // Handle agent events
              this.responseHandler.handleAgentEvent(event, session, uniqueSessionId);
            }
          );
        } catch (error) {
          logger.error('Error processing transcription:', error);
          session.layouts.showTextWall('Sorry, I encountered an error processing your message.');
        }
      }
    });

    // Listen for interruptions (user speaking while agent is responding)
    session.events.onTranscription((data) => {
      if (!data.isFinal && this.agentManager.getSession(uniqueSessionId)?.currentRunSubscription) {
        // User started speaking while agent is responding - interrupt
        this.agentManager.interruptSession(uniqueSessionId);
      }
    });

    // automatically remove the session when the session ends
    this.addCleanupHandler(() => {
      this.userSessionsMap.delete(userId);
      const sessionId = this.sessionIdMap.get(userId);
      if (sessionId) {
        this.agentManager.removeSession(sessionId);
        this.responseHandler.cleanupSession(sessionId);
        this.sessionIdMap.delete(userId);
      }
    });
  }
}

// Start the server
const app = new ExampleMentraOSApp();

app.start().catch(logger.error);