import { Agent } from '@ag-ui/core';

// Example implementation showing how to configure different types of agui backend agents
// Copy this to agentConfig.ts and uncomment the appropriate section for your agent type

export function createBackendAgent(): Agent {
  const AGUI_BACKEND_URL = process.env.AGUI_BACKEND_URL || 'http://localhost:8001';
  const AGUI_BACKEND_AGENT_ID = process.env.AGUI_BACKEND_AGENT_ID;

  if (!AGUI_BACKEND_AGENT_ID) {
    throw new Error('AGUI_BACKEND_AGENT_ID is not set in .env file');
  }

  // --- Example 1: HTTP-based Agent ---
  // If your agent communicates via HTTP/REST API:
  /*
  return {
    threadId: undefined,
    abortController: new AbortController(),
    
    run: (input) => {
      // Return an Observable that makes HTTP requests to your backend
      return new Observable((observer) => {
        fetch(`${AGUI_BACKEND_URL}/agents/${AGUI_BACKEND_AGENT_ID}/run`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
          signal: this.abortController?.signal
        })
        .then(response => response.body)
        .then(body => {
          const reader = body.getReader();
          // Process streaming response
          // Parse events and call observer.next(event)
        });
      });
    },
    
    clone: function() {
      return createBackendAgent();
    },
    
    abortRun: function() {
      this.abortController?.abort();
    }
  };
  */

  // --- Example 2: WebSocket-based Agent ---
  // If your agent uses WebSocket for real-time communication:
  /*
  return {
    threadId: undefined,
    ws: null,
    
    run: (input) => {
      return new Observable((observer) => {
        this.ws = new WebSocket(`${AGUI_BACKEND_URL.replace('http', 'ws')}/agents/${AGUI_BACKEND_AGENT_ID}`);
        
        this.ws.onopen = () => {
          this.ws.send(JSON.stringify(input));
        };
        
        this.ws.onmessage = (event) => {
          const agentEvent = JSON.parse(event.data);
          observer.next(agentEvent);
        };
        
        this.ws.onerror = (error) => {
          observer.error(error);
        };
        
        this.ws.onclose = () => {
          observer.complete();
        };
      });
    },
    
    clone: function() {
      return createBackendAgent();
    },
    
    abortRun: function() {
      this.ws?.close();
    }
  };
  */

  // --- Example 3: Using an SDK Client ---
  // If you have an SDK client library for your agent:
  /*
  const { AgentClient } = require('@your-org/agent-sdk');
  
  const client = new AgentClient({
    baseUrl: AGUI_BACKEND_URL,
    agentId: AGUI_BACKEND_AGENT_ID,
    // other options like API keys, etc.
  });
  
  return client.getAgent();
  */

  throw new Error(
    'Backend agent not configured. Please implement createBackendAgent() in src/config/agentConfig.ts'
  );
}