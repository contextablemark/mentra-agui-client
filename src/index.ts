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
  private agentManager?: AgentManager;
  private responseHandler?: ResponseHandler;
  private sessionIdMap = new Map<string, string>(); // userId -> sessionId mapping

  constructor() {
    logger.info("Initializing MentraOS app", { 
      packageName: PACKAGE_NAME, 
      port: PORT, 
      stateful: AGENT_STATEFUL 
    });

    super({
      packageName: PACKAGE_NAME,
      apiKey: MENTRAOS_API_KEY,
      port: PORT,
      publicDir: path.join(__dirname, '../public'),
    });

    // Set up Express routes
    setupExpressRoutes(this);
    logger.debug("Express routes configured");
    logger.info("MentraOS app initialized - agent will be created per session");
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
    logger.info("New session started", { userId, sessionId });
    
    this.userSessionsMap.set(userId, session);

    // Generate unique session ID for this conversation
    const uniqueSessionId = `${userId}-${Date.now()}-${uuidv4()}`;
    this.sessionIdMap.set(userId, uniqueSessionId);
    
    logger.debug("Generated unique session ID", { userId, uniqueSessionId });

    // Get AG-UI backend URL from user settings
    const backendUrl = session.settings.get<string>('AgUiBackend');
    
    if (!backendUrl || backendUrl.trim() === '') {
      logger.warn("No AG-UI backend configured for user", { userId });
      session.layouts.showTextWall("Please configure AG-UI Backend URL in app settings");
      return;
    }

    try {
      // Initialize AgentManager with user's backend URL
      logger.debug("Creating backend agent with URL", { backendUrl, userId });
      const backendAgent = createBackendAgent(backendUrl);
      logger.debug("Backend agent created successfully", { userId });
      
      this.agentManager = new AgentManager({
        backendAgent,
        stateful: AGENT_STATEFUL
      });
      this.responseHandler = new ResponseHandler(this.agentManager);
      logger.info("AgentManager and ResponseHandler initialized for session", { userId });

      // Create agent session
      this.agentManager.createSession(uniqueSessionId, userId);
      logger.debug("Agent session created successfully", { uniqueSessionId });

      // Initialize display manager for this session
      this.responseHandler.initializeSession(uniqueSessionId, session);
      
      // Show welcome message
      session.layouts.showTextWall("Connected to assistant");
      logger.info("Welcome message displayed", { userId, uniqueSessionId });
    } catch (error) {
      logger.error("Failed to initialize session", { userId, uniqueSessionId, error });
      session.layouts.showTextWall("Failed to connect to AG-UI backend. Please check your configuration.");
      return;
    }

    // Listen for transcriptions
    session.events.onTranscription(async (data) => {
      if (data.isFinal && this.agentManager && this.responseHandler) {
        logger.debug("Transcript received:", { text: data.text, userId, sessionId: uniqueSessionId });
        
        try {
          // Process transcription through agent
          await this.agentManager.processTranscription(
            uniqueSessionId,
            data.text,
            (event) => {
              // Handle agent events
              this.responseHandler!.handleAgentEvent(event, session, uniqueSessionId);
            }
          );
        } catch (error) {
          logger.error('Error processing transcription:', error);
          // Use response handler to display error through display manager
          this.responseHandler.handleAgentEvent({
            type: 'ERROR',
            error: 'Failed to process transcription'
          } as any, session, uniqueSessionId);
        }
      }
    });

    // Listen for interruptions (user speaking while agent is responding)
    session.events.onTranscription((data) => {
      if (!data.isFinal && this.agentManager && this.responseHandler && this.agentManager.getSession(uniqueSessionId)?.currentRunSubscription) {
        // User started speaking while agent is responding - interrupt
        this.agentManager.interruptSession(uniqueSessionId);
        this.responseHandler.handleInterruption(uniqueSessionId);
      }
    });

    // Listen for button press events
    try {
      session.events.onButtonPress((data) => {
        try {
          logger.debug('Button press event received', {
            sessionId: uniqueSessionId,
            buttonId: data.buttonId,
            pressType: data.pressType,
            userId
          });

          // Handle short button press to toggle pause/resume
          if (data.pressType === 'short') {
            if (!this.responseHandler) {
              logger.warn('No response handler available for button press', { sessionId: uniqueSessionId });
              return;
            }

            try {
              const isPaused = this.responseHandler.isTextDisplayPaused(uniqueSessionId);
              logger.debug('Current pause state', { sessionId: uniqueSessionId, isPaused });

              if (isPaused) {
                this.responseHandler.resumeTextDisplay(uniqueSessionId, session);
                logger.info('Text scrolling resumed by button press', { 
                  sessionId: uniqueSessionId, 
                  buttonId: data.buttonId 
                });
              } else {
                this.responseHandler.pauseTextDisplay(uniqueSessionId);
                logger.info('Text scrolling paused by button press', { 
                  sessionId: uniqueSessionId, 
                  buttonId: data.buttonId 
                });
              }
            } catch (displayError) {
              logger.error('Error handling text display pause/resume', {
                sessionId: uniqueSessionId,
                error: displayError
              });
            }
          } else {
            logger.debug('Non-short button press ignored', {
              sessionId: uniqueSessionId,
              pressType: data.pressType
            });
          }
        } catch (handlerError) {
          logger.error('Error in button press event handler', {
            sessionId: uniqueSessionId,
            error: handlerError
          });
        }
      });
      logger.debug('Button press event listener registered', { sessionId: uniqueSessionId });
    } catch (registrationError) {
      logger.error('Failed to register button press event listener', {
        sessionId: uniqueSessionId,
        error: registrationError
      });
    }

    // automatically remove the session when the session ends
    this.addCleanupHandler(() => {
      logger.info("Cleaning up session", { userId, uniqueSessionId });
      this.userSessionsMap.delete(userId);
      const sessionId = this.sessionIdMap.get(userId);
      if (sessionId && this.agentManager && this.responseHandler) {
        this.agentManager.removeSession(sessionId);
        this.responseHandler.cleanupSession(sessionId);
        this.sessionIdMap.delete(userId);
        logger.debug("Session cleanup completed", { userId, sessionId });
      }
    });
1  }
}

// Start the server
logger.info("Starting MentraOS app server");
const app = new ExampleMentraOSApp();

app.start()
  .then(() => {
    logger.info("MentraOS app server started successfully");
  })
  .catch((error) => {
    logger.error("Failed to start MentraOS app server:", error);
  });