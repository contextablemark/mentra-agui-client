import { HttpAgent } from '@ag-ui/client';

// Create the AG-UI HTTP backend agent with configurable URL
export function createBackendAgent(backendUrl: string) {
  if (!backendUrl || backendUrl.trim() === '') {
    throw new Error('AG-UI Backend URL is required');
  }

  const AGUI_API_KEY = process.env.AGUI_API_KEY;

  // Create the backend agent using HttpAgent from @ag-ui/client
  const backendAgent = new HttpAgent({
    url: backendUrl,
    headers: AGUI_API_KEY ? {
      Authorization: `Bearer ${AGUI_API_KEY}`
    } : {}
  });

  return backendAgent;
}