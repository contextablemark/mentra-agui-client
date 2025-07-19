/**
 * Wraps text to fit within a specified line width
 * Adapted from MentraOS Teleprompter implementation
 */
export function wrapText(text: string, maxLength: number = 30): string {
  if (typeof text !== 'string') {
    return '';
  }

  // Split the text into lines (respecting existing line breaks)
  const lines = text.split('\n');
  const wrappedLines: string[] = [];

  for (const line of lines) {
    if (line.length <= maxLength) {
      wrappedLines.push(line);
      continue;
    }

    // Split long lines into words
    const words = line.split(' ');
    let currentLine = '';

    for (const word of words) {
      // If adding this word would exceed maxLength
      if (currentLine.length + word.length + (currentLine.length > 0 ? 1 : 0) > maxLength) {
        if (currentLine.length > 0) {
          wrappedLines.push(currentLine);
          currentLine = '';
        }

        // If the word itself is longer than maxLength, break it
        if (word.length > maxLength) {
          let remainingWord = word;
          while (remainingWord.length > maxLength) {
            wrappedLines.push(remainingWord.substring(0, maxLength));
            remainingWord = remainingWord.substring(maxLength);
          }
          currentLine = remainingWord;
        } else {
          currentLine = word;
        }
      } else {
        // Add word to current line
        currentLine = currentLine.length > 0 ? currentLine + ' ' + word : word;
      }
    }

    // Add any remaining text
    if (currentLine.length > 0) {
      wrappedLines.push(currentLine);
    }
  }

  return wrappedLines.join('\n');
}

/**
 * Splits wrapped text into an array of lines
 */
export function splitIntoLines(text: string): string[] {
  return text.split('\n').filter(line => line !== undefined);
}

/**
 * Estimates average words per line for wrapped text
 */
export function estimateWordsPerLine(lines: string[]): number {
  if (lines.length === 0) return 0;
  
  const totalWords = lines.reduce((sum, line) => {
    return sum + line.trim().split(/\s+/).filter(word => word.length > 0).length;
  }, 0);
  
  return totalWords / lines.length;
}