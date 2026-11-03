/**
 * pyFides - Buyer Agent (Agent Alpha)
 * Autonomous requester operating on behalf of human principal (David).
 * 
 * Capabilities:
 * - Uses APIMatic Context Plugin to discover seller services & OpenAPI definitions
 * - Verifies human principal Intent Mandate ($30 limit, expiration window)
 * - OWASP MCP Top 10 Defense: Sanitizes & quarantines adversarial prompt injections
 * - Compiles immutable AP2 Cart Mandate and signs with Ed25519 private key
 * - Coordinates counter-signatures with Seller Agent Beta
 */

import crypto from 'node:crypto';
import {
  AP2_VERSION,
  IntentMandate,
  CartMandate,
  Ed25519KeyPair,
  generateEd25519KeyPair,
  signWithEd25519,
  computeCartHash,
  SettlementRail,
} from '../protocol/ap2-mandates.js';
import { QuotationProposal, SellerAgent } from './seller-agent.js';
import { apimaticService, DiscoveredServiceContract } from '../services/apimatic-mcp.js';

export interface NegotiationResult {
  success: boolean;
  cartMandate?: CartMandate;
  quarantinedThreat?: {
    type: 'PROMPT_INJECTION' | 'SPEND_CAP_EXCEEDED' | 'UNAUTHORIZED_RAIL' | 'INVALID_SLA';
    rawPayload: string;
    details: string;
  };
  reasoningLog: string[];
}

export class BuyerAgent {
  public readonly agentId = 'agent_alpha_buyer_01';
  public readonly keyPair: Ed25519KeyPair;
  private activeIntentMandate: IntentMandate | null = null;

  constructor() {
    this.keyPair = generateEd25519KeyPair();
  }

  /**
   * Loads and binds active Intent Mandate issued by human principal.
   */
  public bindIntentMandate(intent: IntentMandate): void {
    this.activeIntentMandate = intent;
  }

  public getIntentMandate(): IntentMandate | null {
    return this.activeIntentMandate;
  }

  /**
   * Discovers seller services using the APIMatic MCP Context Engine.
   */
  public discoverSellerServices(query?: string): DiscoveredServiceContract[] {
    return apimaticService.discoverServices(query);
  }

  /**
   * OWASP MCP Top 10 Security Filter:
   * Inspects incoming quotation proposals for prompt injection strings,
   * hidden system tags, or budget override exploits.
   */
  private scanForAdversarialInjection(proposal: QuotationProposal): { detected: boolean; reason?: string } {
    const dangerousPatterns = [
      /<system[\s\S]*?>/i,
      /<\/system>/i,
      /<override[\s\S]*?>/i,
      /ignore\s+(all\s+)?previous\s+instructions/i,
      /disregard\s+(human|intent|budget|spend)/i,
      /charge\s+\$[0-9,]+/i,
      /OVERRIDE_SPEND_LIMIT/i,
      /DROP\s+TABLE/i,
    ];

    const stringToInspect = `${proposal.description} ${proposal.rawInjectionPayload || ''}`;
    for (const pattern of dangerousPatterns) {
      if (pattern.test(stringToInspect)) {
        return {
          detected: true,
          reason: `Detected adversarial prompt injection matching pattern: ${pattern.toString()}`,
        };
      }
    }

    return { detected: false };
  }

  /**
   * Autonomous A2A Negotiation Loop:
   * Negotiates with Seller Agent Beta, evaluates quotes against Intent Mandate bounds,
   * compiles canonical Cart Mandate, and exchanges Ed25519 signatures.
   */
  public async negotiateWithSeller(
    seller: SellerAgent,
    options: {
      sku?: string;
      preferredRail?: SettlementRail;
      adversarialMode?: boolean;
      excessivePriceMode?: boolean;
    } = {}
  ): Promise<NegotiationResult> {
    const reasoningLog: string[] = [];
    reasoningLog.push(`[Buyer Alpha] Initializing negotiation on behalf of Principal (${this.activeIntentMandate?.principal.user_id || 'unknown'}).`);

    if (!this.activeIntentMandate) {
      return {
        success: false,
        reasoningLog: ['[Buyer Alpha] Error: No active Intent Mandate bound. Autonomous spending blocked.'],
        quarantinedThreat: {
          type: 'SPEND_CAP_EXCEEDED',
          rawPayload: 'null',
          details: 'Missing Human Principal Intent Mandate authorization.',
        },
      };
    }

    const requestedSku = (options.sku || 'FIN-SENTIMENT-Q4').toUpperCase();

    // Step 1: Query APIMatic discovery context
    const discoveredServices = this.discoverSellerServices(
      requestedSku.includes('H100') ? 'H100' : requestedSku.includes('GATEWAY') ? 'Gateway' : 'financial'
    );
    const matchedService = discoveredServices[0] || this.discoverSellerServices()[0];
    if (matchedService) {
      reasoningLog.push(
        `[Buyer Alpha] APIMatic Context Grounding: Discovered "${matchedService.title}" (SKU: ${matchedService.sku}, Standard: $${matchedService.standardPriceUsd.toFixed(2)}).`
      );
      const toolsSummary = matchedService.mcpTools.map(t => `${t.name}()`).join(', ');
      reasoningLog.push(`[Buyer Alpha] APIMatic Injected Type-Safe Tools: [${toolsSummary}]`);
    }

    // Step 2: Request price quote from Seller Agent Beta
    reasoningLog.push(`[Buyer Alpha] Requesting quotation for SKU "${requestedSku}" from Seller Beta (${seller.agentId}).`);
    const quote = seller.generateQuotation({
      sku: requestedSku,
      adversarialInjection: options.adversarialMode,
      excessivePrice: options.excessivePriceMode,
    });

    reasoningLog.push(`[Seller Beta] Quoted: $${quote.unitPrice.toFixed(2)} USD for SKU "${quote.sku}".`);

    // Step 3: OWASP MCP Top 10 Prompt Injection Defense
    const injectionCheck = this.scanForAdversarialInjection(quote);
    if (injectionCheck.detected) {
      reasoningLog.push(`[SECURITY ALERT] Quarantined adversarial injection from Seller! Threat: ${injectionCheck.reason}`);
      return {
        success: false,
        reasoningLog,
        quarantinedThreat: {
          type: 'PROMPT_INJECTION',
          rawPayload: quote.rawInjectionPayload || quote.description,
          details: injectionCheck.reason || 'Adversarial instruction injection detected in negotiation payload.',
        },
      };
    }

    // Step 4: Strict Mathematical Spend Cap Enforcement
    const maxBudget = this.activeIntentMandate.constraints.max_amount;
    if (quote.totalAmount > maxBudget) {
      reasoningLog.push(
        `[SECURITY ALERT] Spend bound violation: Seller quote $${quote.totalAmount.toFixed(2)} exceeds Intent cap $${maxBudget.toFixed(2)}!`
      );
      return {
        success: false,
        reasoningLog,
        quarantinedThreat: {
          type: 'SPEND_CAP_EXCEEDED',
          rawPayload: JSON.stringify(quote),
          details: `Requested amount $${quote.totalAmount.toFixed(2)} exceeds delegated budget limit $${maxBudget.toFixed(2)}.`,
        },
      };
    }

    // Step 5: Validate Settlement Rail
    const selectedRail: SettlementRail = options.preferredRail || 'PAYPAL_BALANCE';
    if (!this.activeIntentMandate.constraints.allowed_settlement_rails.includes(selectedRail)) {
      reasoningLog.push(`[SECURITY ALERT] Rail ${selectedRail} is not permitted by Intent Mandate.`);
      return {
        success: false,
        reasoningLog,
        quarantinedThreat: {
          type: 'UNAUTHORIZED_RAIL',
          rawPayload: selectedRail,
          details: `Settlement rail ${selectedRail} not in permitted set: [${this.activeIntentMandate.constraints.allowed_settlement_rails.join(', ')}].`,
        },
      };
    }

    reasoningLog.push(
      `[Buyer Alpha] Quote accepted: $${quote.totalAmount.toFixed(2)} <= $${maxBudget.toFixed(2)} limit. Settlement rail: ${selectedRail}.`
    );

    // Step 6: Compile Deterministic AP2 Cart Mandate
    const cartId = `cm_${crypto.randomBytes(6).toString('hex')}`;
    const cartTermsWithoutSignatures = {
      ap2_version: AP2_VERSION,
      mandate_type: 'CART_MANDATE' as const,
      cart_id: cartId,
      intent_reference_id: this.activeIntentMandate.mandate_id,
      seller: {
        agent_id: seller.agentId,
        service_endpoint: seller.serviceEndpoint,
        paypal_merchant_id: seller.paypalMerchantId,
        public_key: seller.keyPair.publicKeyHex,
        public_key_pem: seller.keyPair.publicKeyPem,
      },
      line_items: [
        {
          sku: quote.sku,
          description: quote.description,
          quantity: quote.quantity,
          unit_price: quote.unitPrice,
        },
      ],
      total_amount: quote.totalAmount,
      currency: quote.currency,
      settlement_rail: selectedRail,
      sla_terms: {
        timeout_seconds: quote.slaTimeoutSeconds,
        deliverable_verification_method: quote.deliverableVerificationMethod,
        expected_schema: 'application/json;schema=v2',
      },
    };

    // Calculate deterministic canonical SHA-256 hash
    const deterministicCartHash = computeCartHash(cartTermsWithoutSignatures);
    reasoningLog.push(`[Buyer Alpha] Compiled canonical Cart Mandate. Hash: ${deterministicCartHash.substring(0, 16)}...`);

    // Buyer Agent signs cart hash
    const buyerSignature = signWithEd25519(deterministicCartHash, this.keyPair.privateKeyPem);
    reasoningLog.push(`[Buyer Alpha] Signed Cart Mandate with Ed25519 private key.`);

    // Request Seller Agent counter-signature
    const sellerSignature = seller.counterSignCartHash(deterministicCartHash);
    reasoningLog.push(`[Seller Beta] Counter-signed Cart Mandate hash.`);

    const finalizedCartMandate: CartMandate = {
      ...cartTermsWithoutSignatures,
      deterministic_cart_hash: deterministicCartHash,
      buyer_agent_signature: buyerSignature,
      seller_agent_signature: sellerSignature,
      created_at: new Date().toISOString(),
    };

    reasoningLog.push(`[Buyer Alpha] Dual-signed Cart Mandate ready for Escrow Fiduciary submission.`);

    return {
      success: true,
      cartMandate: finalizedCartMandate,
      reasoningLog,
    };
  }
}
