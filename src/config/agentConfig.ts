import { HttpAgent } from '@ag-ui/client';

// Create the AG-UI HTTP backend agent - identical to TwilioAgent setup
export function createBackendAgent() {
  const AGUI_BACKEND_URL = process.env.AGUI_BACKEND_URL || 'http://localhost:8000/chat';
  const AGUI_API_KEY = process.env.AGUI_API_KEY;

  // Create the backend agent using HttpAgent from @ag-ui/client
  const backendAgent = new HttpAgent({
    url: AGUI_BACKEND_URL,
    headers: AGUI_API_KEY ? {
      Authorization: `Bearer ${AGUI_API_KEY}`
    } : {}
  });

  return backendAgent;
}