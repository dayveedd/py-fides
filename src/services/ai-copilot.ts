/**
 * pyFides — AI Copilot Service
 * Integrates Qwen Cloud (DashScope) with resilient fallback for Machine-to-Machine Fiduciary Intent Parsing.
 */

import { SettlementRail } from '../protocol/ap2-mandates.js';

export interface ParsedFiduciaryIntent {
  sku: string;
  rail: SettlementRail;
  budget: number;
  isAdversarial: boolean;
  isTampered: boolean;
  isTimeout: boolean;
  explanation: string;
  sourceModel: string;
}

export class AiCopilotService {
  private apiKey: string | undefined;
  private model: string;
  private baseUrl: string;

  constructor() {
    this.apiKey = process.env.QWEN_API_KEY || 'sk-ws-H.XHYXMR.QZHK.MEYCIQC_ZGr-K6Ej-6mINuhZRd-3GWNwiKxt6OpP57_JMx0K6QIhANDvWLBdPi9al4sXqvLIi8vHS028Z9JO5eT5mlvtzWFY';
    this.model = process.env.QWEN_MODEL || 'kimi-k3.1-pro';
    this.baseUrl = process.env.QWEN_BASE_URL || 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1';
  }

  /**
   * Parses natural language user input into structured AP2 intent
   */
  public async parseUserIntent(userMessage: string): Promise<ParsedFiduciaryIntent> {
    const trimmed = userMessage.trim();

    // 1. Attempt LLM inference via Qwen Cloud if API key is present
    if (this.apiKey && !this.apiKey.includes('your_qwen_api_key')) {
      try {
        const llmResult = await this.callQwenModel(trimmed);
        if (llmResult) {
          return llmResult;
        }
      } catch (err) {
        // Fallback to local heuristic parser on network error or quota expiration
      }
    }

    // 2. Deterministic high-precision fallback parser
    return this.fallbackParse(trimmed);
  }

  private async callQwenModel(userMessage: string): Promise<ParsedFiduciaryIntent | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 18000);

    const systemPrompt = `You are Buyer Agent Alpha's natural language parser for pyFides, an AP2-compliant autonomous machine-to-machine escrow agent on PayPal rails.
Given the user prompt, output ONLY a valid JSON object with these exact keys:
{
  "sku": "COMPUTE-H100-BURST" | "FIN-SENTIMENT-Q4" | "API-GATEWAY-SUB" | "SMART-AUDIT-FORMAL" | "GEO-SATELLITE-VECTORS" | "WHISPER-SPEECH-BATCH",
  "rail": "PAYPAL_BALANCE" | "PYUSD",
  "budget": number,
  "isAdversarial": boolean,
  "isTampered": boolean,
  "isTimeout": boolean,
  "explanation": "Concise 1-2 sentence Apple-grade fiduciary reasoning explaining how you are locking funds in PayPal Orders v2 escrow under the user's hard cap."
}`;

    try {
      const requestPayload: Record<string, unknown> = {
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        response_format: { type: 'json_object' },
      };

      // Kimi-k3 models do not accept custom temperature parameter
      if (!this.model.toLowerCase().includes('kimi')) {
        requestPayload.temperature = 0.1;
      }

      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestPayload),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        return null;
      }

      const data = await response.json() as any;
      const content = data.choices?.[0]?.message?.content;
      if (!content) return null;

      const parsed = JSON.parse(content);
      return {
        sku: parsed.sku || 'COMPUTE-H100-BURST',
        rail: parsed.rail === 'PYUSD' ? 'PYUSD' : 'PAYPAL_BALANCE',
        budget: typeof parsed.budget === 'number' ? Math.min(parsed.budget, 30.0) : 30.0,
        isAdversarial: Boolean(parsed.isAdversarial),
        isTampered: Boolean(parsed.isTampered),
        isTimeout: Boolean(parsed.isTimeout),
        explanation: parsed.explanation || 'Delegated spend validated within Intent Mandate bounds.',
        sourceModel: `Cloud Engine (${this.model})`,
      };
    } catch {
      clearTimeout(timeout);
      return null;
    }
  }

  private fallbackParse(userMessage: string): ParsedFiduciaryIntent {
    const lower = userMessage.toLowerCase();

    let sku = 'FIN-SENTIMENT-Q4';
    let rail: SettlementRail = 'PAYPAL_BALANCE';
    let budget = 30.0;
    let isAdversarial = false;
    let isTampered = false;
    let isTimeout = false;

    // Detect SKU
    if (lower.includes('h100') || lower.includes('gpu') || lower.includes('compute') || lower.includes('inference')) {
      sku = 'COMPUTE-H100-BURST';
    } else if (lower.includes('audit') || lower.includes('solidity') || lower.includes('smart contract') || lower.includes('formal verification')) {
      sku = 'SMART-AUDIT-FORMAL';
    } else if (lower.includes('satellite') || lower.includes('geo') || lower.includes('climate') || lower.includes('earth')) {
      sku = 'GEO-SATELLITE-VECTORS';
    } else if (lower.includes('whisper') || lower.includes('speech') || lower.includes('transcription') || lower.includes('audio')) {
      sku = 'WHISPER-SPEECH-BATCH';
    } else if (lower.includes('gateway') || lower.includes('proxy') || lower.includes('api')) {
      sku = 'API-GATEWAY-SUB';
    } else if (lower.includes('sentiment') || lower.includes('10-k') || lower.includes('financial') || lower.includes('sec')) {
      sku = 'FIN-SENTIMENT-Q4';
    }

    // Detect Settlement Rail
    if (lower.includes('pyusd') || lower.includes('stablecoin') || lower.includes('crypto')) {
      rail = 'PYUSD';
    }

    // Detect Security / Fault Injections
    if (lower.includes('inject') || lower.includes('adversar') || lower.includes('hack') || lower.includes('prompt attack')) {
      isAdversarial = true;
    }
    if (lower.includes('tamper') || lower.includes('fraud') || lower.includes('corrupt') || lower.includes('fake digest')) {
      isTampered = true;
    }
    if (lower.includes('timeout') || lower.includes('sla') || lower.includes('expire') || lower.includes('lag')) {
      isTimeout = true;
    }

    // Extract Spend Cap if mentioned (e.g. "$30", "under 28")
    const matchCap = userMessage.match(/\$?\s*([0-9]+(?:\.[0-9]{1,2})?)/);
    if (matchCap && matchCap[1]) {
      const val = parseFloat(matchCap[1]);
      if (!isNaN(val) && val > 0 && val <= 30.0) {
        budget = val;
      }
    }

    const explanation = `Authorized David's Intent Mandate for SKU "${sku}" on ${rail} rails with a hard limit of $${budget.toFixed(2)} USD.`;

    return {
      sku,
      rail,
      budget,
      isAdversarial,
      isTampered,
      isTimeout,
      explanation,
      sourceModel: 'pyFides Fiduciary Rule Engine (Offline Resilient)',
    };
  }
}

export const aiCopilotService = new AiCopilotService();
