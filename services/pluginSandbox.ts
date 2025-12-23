import { GeminiApiRequest, PluginApiResponse } from "../types.ts";
import { logger } from "./loggingService.ts";

const workerCode = `
  let userHooks = {};
  let apiTicketCounter = 0;
  const pendingApiRequests = new Map();

  const nexus = {
    log: (...args) => {
      self.postMessage({ type: 'LOG', payload: args });
    },
    hooks: {
      register: (hookName, callback) => {
        if (typeof callback === 'function') {
          userHooks[hookName] = callback;
        }
      },
    },
    gemini: {
      generateContent: (prompt) => {
        return new Promise((resolve, reject) => {
          const ticket = apiTicketCounter++;
          pendingApiRequests.set(ticket, { resolve, reject });
          self.postMessage({ type: 'API_REQUEST', payload: { ticket, apiRequest: { type: 'generateContent', prompt } } });
        });
      },
      generateImage: (prompt, settings) => {
         return new Promise((resolve, reject) => {
          const ticket = apiTicketCounter++;
          pendingApiRequests.set(ticket, { resolve, reject });
          self.postMessage({ type: 'API_REQUEST', payload: { ticket, apiRequest: { type: 'generateImage', prompt, settings } } });
        });
      }
    }
  };

  self.onmessage = async (e) => {
    const { type, payload } = e.data;
    switch (type) {
      case 'LOAD_CODE':
        try {
          const pluginFunction = new Function('nexus', payload.code);
          pluginFunction(nexus);
          self.postMessage({ type: 'LOAD_SUCCESS' });
        } catch (error) {
          self.postMessage({ type: 'LOAD_ERROR', error: error.message });
        }
        break;
      case 'EXECUTE_HOOK':
        const hook = userHooks[payload.hookName];
        if (hook) {
          try {
            const result = await hook(payload.data);
            self.postMessage({ type: 'HOOK_RESULT', ticket: payload.ticket, result: result });
          } catch (error) {
            self.postMessage({ type: 'HOOK_ERROR', ticket: payload.ticket, error: error.message });
          }
        } else {
          self.postMessage({ type: 'HOOK_RESULT', ticket: payload.ticket, result: payload.data });
        }
        break;
      case 'API_RESPONSE':
        const promise = pendingApiRequests.get(payload.ticket);
        if (promise) {
          if (payload.error) promise.reject(new Error(payload.error));
          else promise.resolve(payload.result);
          pendingApiRequests.delete(payload.ticket);
        }
        break;
    }
  };
`;

export class PluginSandbox {
  private worker: Worker;
  private ticketCounter = 0;
  private pendingHooks = new Map<number, { resolve: (value: any) => void; reject: (reason?: any) => void }>();
  private apiRequestHandler: (request: GeminiApiRequest) => Promise<any>;

  constructor(apiRequestHandler: (request: GeminiApiRequest) => Promise<any>) {
    this.apiRequestHandler = apiRequestHandler;
    const blob = new Blob([workerCode], { type: 'application/javascript' });
    this.worker = new Worker(URL.createObjectURL(blob));
    this.worker.onmessage = async (e) => {
      const { type, payload, ticket, result, error } = e.data;
      if (type === 'LOG') {
        logger.log(`[Plugin] ${payload.join(' ')}`);
      } else if (type === 'API_REQUEST') {
        try {
          const apiResult = await this.apiRequestHandler(payload.apiRequest);
          this.worker.postMessage({ type: 'API_RESPONSE', payload: { ticket: payload.ticket, result: apiResult } });
        } catch (apiError) {
          this.worker.postMessage({ type: 'API_RESPONSE', payload: { ticket: payload.ticket, error: String(apiError) } });
        }
      } else if (ticket !== undefined && this.pendingHooks.has(ticket)) {
        const promise = this.pendingHooks.get(ticket)!;
        if (type === 'HOOK_RESULT') promise.resolve(result);
        else promise.reject(new Error(error));
        this.pendingHooks.delete(ticket);
      }
    };
  }

  loadCode(code: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const listener = (e: MessageEvent) => {
        if (e.data.type === 'LOAD_SUCCESS') {
          this.worker.removeEventListener('message', listener);
          resolve();
        } else if (e.data.type === 'LOAD_ERROR') {
          this.worker.removeEventListener('message', listener);
          reject(new Error(e.data.error));
        }
      };
      this.worker.addEventListener('message', listener);
      this.worker.postMessage({ type: 'LOAD_CODE', payload: { code } });
    });
  }

  executeHook<T>(hookName: string, data: T): Promise<T> {
    return new Promise((resolve, reject) => {
      const ticket = this.ticketCounter++;
      this.pendingHooks.set(ticket, { resolve, reject });
      this.worker.postMessage({ type: 'EXECUTE_HOOK', payload: { hookName, data, ticket } });
    });
  }

  terminate() { this.worker.terminate(); }
}