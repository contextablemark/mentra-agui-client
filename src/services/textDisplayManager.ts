import { AppSession } from '@mentra/sdk';
import { logger } from '../utils/logger';
import { wrapText, splitIntoLines } from '../utils/textWrapper';

interface DisplayState {
  sessionId: string;
  lines: string[];
  currentLinePosition: number;
  displayInterval?: NodeJS.Timeout;
  isDisplaying: boolean;
  isPaused: boolean;
  lineBuffer: string;
  messageComplete: boolean;
}

export class TextDisplayManager {
  private displayStates: Map<string, DisplayState> = new Map();
  private defaultCharsPerLine = 30; // Default characters per line
  private defaultMaxLines = 4; // Default visible lines
  private defaultScrollIntervalMs = 250; // Default scroll speed in milliseconds per line
  
  /**
   * Initialize display for a session
   */
  initializeSession(sessionId: string, session: AppSession): void {
    const maxLines = session.capabilities?.screen?.maxTextLines || this.defaultMaxLines;
    const charsPerLine = this.getCharsPerLine(session);
    
    logger.debug('Initializing text display', {
      sessionId,
      maxLines,
      charsPerLine,
      deviceModel: session.capabilities?.modelName
    });

    this.displayStates.set(sessionId, {
      sessionId,
      lines: [],
      currentLinePosition: 0,
      isDisplaying: false,
      isPaused: false,
      lineBuffer: '',
      messageComplete: false
    });
  }

  /**
   * Get characters per line from user settings or device capabilities
   */
  private getCharsPerLine(session: AppSession): number {
    return session.settings.get('lineWidth') || this.defaultCharsPerLine;
  }

  /**
   * Get scroll speed from user settings
   */
  private getScrollSpeed(session: AppSession): number {
    return session.settings.get('scrollSpeed') || this.defaultScrollIntervalMs;
  }

  /**
   * Check if smart text wrapping is enabled
   */
  private isSmartWrappingEnabled(session: AppSession): boolean {
    return session.settings.get('textWrapping') !== false; // Default to true
  }

  /**
   * Add text chunk to the display
   */
  addTextChunk(sessionId: string, text: string, session: AppSession): void {
    const state = this.displayStates.get(sessionId);
    if (!state) {
      logger.warn('No display state found for session', { sessionId });
      return;
    }

    // Add text to line buffer
    state.lineBuffer += text;
    
    // Process complete sentences or phrases (split on punctuation)
    const processableText = this.extractProcessableText(state, session);
    if (processableText) {
      const charsPerLine = this.getCharsPerLine(session);
      const wrappedText = wrapText(processableText, charsPerLine);
      const newLines = splitIntoLines(wrappedText);
      
      state.lines.push(...newLines);
      
      logger.debug('Added wrapped text', {
        sessionId,
        newLinesCount: newLines.length,
        totalLines: state.lines.length
      });

      // Start scrolling if not already active
      if (!state.isDisplaying) {
        this.startScrolling(sessionId, session);
      }
    }
  }

  /**
   * Extract text that can be processed (complete sentences/phrases)
   */
  private extractProcessableText(state: DisplayState, session: AppSession): string {
    // Check if smart wrapping is enabled
    if (!this.isSmartWrappingEnabled(session)) {
      // Simple mode: just return all buffered text
      if (state.lineBuffer.length > 0) {
        const processable = state.lineBuffer;
        state.lineBuffer = '';
        return processable;
      }
      return '';
    }

    // Smart wrapping mode: Look for natural break points
    const breakPoints = ['. ', '! ', '? ', '\n', ', '];
    let lastBreakIndex = -1;
    
    for (const breakPoint of breakPoints) {
      const index = state.lineBuffer.lastIndexOf(breakPoint);
      if (index > lastBreakIndex) {
        lastBreakIndex = index + breakPoint.length - 1;
      }
    }

    if (lastBreakIndex > -1) {
      const processable = state.lineBuffer.substring(0, lastBreakIndex + 1);
      state.lineBuffer = state.lineBuffer.substring(lastBreakIndex + 1);
      return processable;
    }

    // If buffer is getting long without break points, process anyway
    const charsPerLine = this.getCharsPerLine(session);
    if (state.lineBuffer.length > charsPerLine * 2) {
      const processable = state.lineBuffer;
      state.lineBuffer = '';
      return processable;
    }

    return '';
  }

  /**
   * Complete the message and process any remaining buffer
   */
  completeMessage(sessionId: string, session: AppSession): void {
    const state = this.displayStates.get(sessionId);
    if (!state) return;

    // Process any remaining buffer
    if (state.lineBuffer.trim()) {
      const charsPerLine = this.getCharsPerLine(session);
      const wrappedText = wrapText(state.lineBuffer, charsPerLine);
      const newLines = splitIntoLines(wrappedText);
      state.lines.push(...newLines);
      state.lineBuffer = '';
    }

    // Add spacing after message
    state.lines.push(''); // Empty line for spacing
    state.messageComplete = true;

    logger.info('Message complete', {
      sessionId,
      totalLines: state.lines.length
    });

    // Ensure scrolling continues if there are unread lines
    if (!state.isDisplaying && state.currentLinePosition < state.lines.length) {
      this.startScrolling(sessionId, session);
    }
  }

  /**
   * Start line-by-line scrolling
   */
  private startScrolling(sessionId: string, session: AppSession): void {
    const state = this.displayStates.get(sessionId);
    if (!state || state.isDisplaying) return;

    state.isDisplaying = true;
    const maxLines = session.capabilities?.screen?.maxTextLines || this.defaultMaxLines;

    const scroll = () => {
      // Check if paused
      if (state.isPaused) {
        state.isDisplaying = false;
        return;
      }

      // Calculate lines to display
      const endPosition = Math.min(
        state.currentLinePosition + maxLines,
        state.lines.length
      );
      
      const displayLines = state.lines.slice(state.currentLinePosition, endPosition);
      
      // Pad with empty lines if needed to maintain consistent display
      while (displayLines.length < maxLines) {
        displayLines.push('');
      }

      const displayText = displayLines.join('\n');
      session.layouts.showTextWall(displayText);

      logger.debug('Scrolling display', {
        sessionId,
        currentPosition: state.currentLinePosition,
        displaying: `lines ${state.currentLinePosition}-${endPosition-1}`,
        content: displayText.substring(0, 50) + '...'
      });

      // Check if we should stop scrolling (when last line is visible)
      const lastLineVisible = (state.currentLinePosition + maxLines) >= state.lines.length;
      
      if (state.messageComplete && lastLineVisible) {
        // All content is visible and message is complete - stop scrolling
        logger.info('Scrolling complete - all content visible', {
          sessionId,
          finalPosition: state.currentLinePosition,
          totalLines: state.lines.length,
          maxLines
        });
        this.stopScrolling(sessionId);
        return;
      }

      // Check if we need to wait for more content
      if (state.currentLinePosition >= state.lines.length && !state.messageComplete) {
        // No more lines to show but message not complete - pause scrolling
        state.isDisplaying = false;
        return;
      }

      // Advance by one line for smooth scrolling (only if there are more lines to show)
      if (state.currentLinePosition + maxLines < state.lines.length) {
        state.currentLinePosition++;
      }

      // Continue scrolling if there's more content to show
      if (!lastLineVisible || !state.messageComplete) {
        const scrollSpeed = this.getScrollSpeed(session);
        state.displayInterval = setTimeout(scroll, scrollSpeed);
      } else {
        this.stopScrolling(sessionId);
      }
    };

    // Start scrolling
    scroll();
  }

  /**
   * Stop scrolling and clean up
   */
  private stopScrolling(sessionId: string): void {
    const state = this.displayStates.get(sessionId);
    if (!state) return;

    if (state.displayInterval) {
      clearTimeout(state.displayInterval);
      state.displayInterval = undefined;
    }
    
    state.isDisplaying = false;
    
    logger.debug('Stopped scrolling', {
      sessionId,
      linesDisplayed: state.currentLinePosition,
      totalLines: state.lines.length
    });
  }

  /**
   * Handle interruption - stop display immediately
   */
  interruptDisplay(sessionId: string): void {
    const state = this.displayStates.get(sessionId);
    if (!state) return;

    this.stopScrolling(sessionId);
    
    // Clear pending content and reset state
    state.lines = [];
    state.lineBuffer = '';
    state.currentLinePosition = 0;
    state.messageComplete = false;
    state.isPaused = false;

    logger.debug('Display interrupted', { sessionId });
  }

  /**
   * Pause display for a session
   */
  pauseDisplay(sessionId: string): void {
    const state = this.displayStates.get(sessionId);
    if (!state) return;

    if (state.isDisplaying && !state.isPaused) {
      state.isPaused = true;
      if (state.displayInterval) {
        clearTimeout(state.displayInterval);
        state.displayInterval = undefined;
      }
      state.isDisplaying = false;
      logger.debug('Display paused', { sessionId });
    }
  }

  /**
   * Resume display for a session
   */
  resumeDisplay(sessionId: string, session: AppSession): void {
    const state = this.displayStates.get(sessionId);
    if (!state) return;

    if (state.isPaused && !state.isDisplaying) {
      state.isPaused = false;
      logger.debug('Display resumed', { sessionId });
      
      // Resume scrolling if there are more lines to show
      if (state.currentLinePosition < state.lines.length || !state.messageComplete) {
        this.startScrolling(sessionId, session);
      }
    }
  }

  /**
   * Clean up session
   */
  cleanupSession(sessionId: string): void {
    this.stopScrolling(sessionId);
    this.displayStates.delete(sessionId);
    logger.debug('Cleaned up display session', { sessionId });
  }
}