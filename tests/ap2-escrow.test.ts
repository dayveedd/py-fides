/**
 * pyFides - Comprehensive Test Suite
 * Validates AP2 Cryptographic Mandates, OWASP MCP Top 10 prompt injection defense,
 * APIMatic dynamic discovery, PayPal Orders v2 two-phase escrow, and Oracle release.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import crypto from 'node:crypto';
import {
  AP2_VERSION,
  canonicalizeJson,
  computeSha256,
  generateEd25519KeyPair,
  signWithEd25519,
  verifyEd25519Signature,
  verifyIntentMandate,
  verifyCartMandate,
  verifySettlementProof,
  computeCartHash,
  IntentMandate,
  CartMandate,
  SettlementProof,
  EscrowState,
} from '../src/protocol/ap2-mandates.js';
import { BuyerAgent } from '../src/agents/buyer-agent.js';
import { SellerAgent } from '../src/agents/seller-agent.js';
import { EscrowFiduciaryAgent } from '../src/agents/escrow-fiduciary.js';
import { ApimaticMcpService, FINANCIAL_SENTIMENT_OPENAPI_SPEC } from '../src/services/apimatic-mcp.js';
import { payPalEscrowService } from '../src/services/paypal-service.js';

describe('pyFides: AP2 Protocol & Escrow Architecture', () => {
  let principalKeys: ReturnType<typeof generateEd25519KeyPair>;
  let buyerAgent: BuyerAgent;
  let sellerAgent: SellerAgent;
  let fiduciary: EscrowFiduciaryAgent;

  beforeEach(() => {
    principalKeys = generateEd25519KeyPair();
    buyerAgent = new BuyerAgent();
    sellerAgent = new SellerAgent();
    fiduciary = new EscrowFiduciaryAgent();
  });

  // --- 1. AP2 Cryptographic Engine & Canonicalization ---
  describe('1. AP2 Cryptographic Engine (RFC 8785 & Ed25519)', () => {
    it('should generate byte-identical canonical JSON regardless of key ordering', () => {
      const objA = { z: 1, a: 'test', m: { y: 2, b: 3 } };
      const objB = { a: 'test', m: { b: 3, y: 2 }, z: 1 };

      const canonA = canonicalizeJson(objA);
      const canonB = canonicalizeJson(objB);

      expect(canonA).toBe(canonB);
      expect(computeSha256(objA)).toBe(computeSha256(objB));
    });

    it('should sign and mathematically verify payloads using Ed25519', () => {
      const payload = { test: 'ap2_cryptographic_delegation', value: 42 };
      const signature = signWithEd25519(payload, principalKeys.privateKeyPem);

      const isValid = verifyEd25519Signature(payload, signature, principalKeys.publicKeyPem);
      expect(isValid).toBe(true);

      const tampered = { ...payload, value: 43 };
      const isTamperedValid = verifyEd25519Signature(tampered, signature, principalKeys.publicKeyPem);
      expect(isTamperedValid).toBe(false);
    });
  });

  // --- 2. AP2 Intent Mandate Validation ---
  describe('2. AP2 Intent Mandate (Human Principal Spend Delegation)', () => {
    it('should successfully validate an authentic, non-expired Intent Mandate', () => {
      const validFrom = new Date(Date.now() - 10000).toISOString();
      const validUntil = new Date(Date.now() + 3600000).toISOString();

      const raw = {
        ap2_version: AP2_VERSION,
        mandate_type: 'INTENT_MANDATE' as const,
        mandate_id: 'im_test_valid',
        principal: {
          user_id: 'usr_david_001',
          paypal_payer_id: 'PP-PAYER-884930',
          public_key: principalKeys.publicKeyHex,
          public_key_pem: principalKeys.publicKeyPem,
        },
        constraints: {
          max_amount: 30.0,
          currency: 'USD' as const,
          allowed_settlement_rails: ['PAYPAL_BALANCE', 'PYUSD'] as const,
          permitted_service_types: ['DATA_EXTRACTION', 'INFERENCE_API'],
          valid_from: validFrom,
          valid_until: validUntil,
        },
      };

      const signature = signWithEd25519(raw, principalKeys.privateKeyPem);
      const intentMandate: IntentMandate = { ...raw, signature };

      const result = verifyIntentMandate(intentMandate);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject an expired Intent Mandate', () => {
      const expiredFrom = new Date(Date.now() - 7200000).toISOString();
      const expiredUntil = new Date(Date.now() - 3600000).toISOString();

      const raw = {
        ap2_version: AP2_VERSION,
        mandate_type: 'INTENT_MANDATE' as const,
        mandate_id: 'im_test_expired',
        principal: {
          user_id: 'usr_david_001',
          paypal_payer_id: 'PP-PAYER-884930',
          public_key: principalKeys.publicKeyHex,
          public_key_pem: principalKeys.publicKeyPem,
        },
        constraints: {
          max_amount: 30.0,
          currency: 'USD' as const,
          allowed_settlement_rails: ['PAYPAL_BALANCE'] as const,
          permitted_service_types: ['DATA_EXTRACTION'],
          valid_from: expiredFrom,
          valid_until: expiredUntil,
        },
      };

      const signature = signWithEd25519(raw, principalKeys.privateKeyPem);
      const expiredMandate: IntentMandate = { ...raw, signature };

      const result = verifyIntentMandate(expiredMandate);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('expired'))).toBe(true);
    });
  });

  // --- 3. APIMatic Dynamic Discovery Integration ---
  describe('3. APIMatic Dynamic Context Discovery', () => {
    it('should ingest OpenAPI 3.1 definitions and synthesize type-safe tools', () => {
      const apimatic = new ApimaticMcpService();
      const contract = apimatic.ingestOpenApiContract(FINANCIAL_SENTIMENT_OPENAPI_SPEC);

      expect(contract.sku).toBe('FIN-SENTIMENT-Q4');
      expect(contract.standardPriceUsd).toBe(25.0);
      expect(contract.mcpTools.length).toBeGreaterThan(0);

      const datasetTool = contract.mcpTools.find((t) => t.name.includes('FinancialSentiment'));
      expect(datasetTool).toBeDefined();
      expect(datasetTool?.parameters.properties).toHaveProperty('recordCount');
    });

    it('should generate grounding context markdown for Buyer Agent Alpha', () => {
      const apimatic = new ApimaticMcpService();
      const context = apimatic.generateAgentContextMarkdown('alphabeta-financial-sentiment-intelligence-service');

      expect(context).toContain('FIN-SENTIMENT-Q4');
      expect(context).toContain('25.00 USD');
      expect(context).toContain('APIMatic Context Plugin');
    });
  });

  // --- 4. OWASP MCP Top 10 Defense (Prompt Injection & Spend Bounds) ---
  describe('4. OWASP MCP Top 10 Prompt Injection Defense', () => {
    it('should detect and quarantine adversarial system prompt injections in negotiation payloads', async () => {
      const validFrom = new Date(Date.now() - 10000).toISOString();
      const validUntil = new Date(Date.now() + 3600000).toISOString();

      const raw = {
        ap2_version: AP2_VERSION,
        mandate_type: 'INTENT_MANDATE' as const,
        mandate_id: 'im_test_security',
        principal: {
          user_id: 'usr_david_001',
          paypal_payer_id: 'PP-PAYER-884930',
          public_key: principalKeys.publicKeyHex,
          public_key_pem: principalKeys.publicKeyPem,
        },
        constraints: {
          max_amount: 30.0,
          currency: 'USD' as const,
          allowed_settlement_rails: ['PAYPAL_BALANCE', 'PYUSD'] as const,
          permitted_service_types: ['DATA_EXTRACTION'],
          valid_from: validFrom,
          valid_until: validUntil,
        },
      };
      const signature = signWithEd25519(raw, principalKeys.privateKeyPem);
      buyerAgent.bindIntentMandate({ ...raw, signature });

      // Run negotiation with adversarial injection active
      const result = await buyerAgent.negotiateWithSeller(sellerAgent, { adversarialMode: true });

      expect(result.success).toBe(false);
      expect(result.quarantinedThreat).toBeDefined();
      expect(result.quarantinedThreat?.type).toBe('PROMPT_INJECTION');
      expect(result.cartMandate).toBeUndefined();
    });

    it('should reject quotation proposals that exceed the Intent Mandate budget cap', async () => {
      const validFrom = new Date(Date.now() - 10000).toISOString();
      const validUntil = new Date(Date.now() + 3600000).toISOString();

      const raw = {
        ap2_version: AP2_VERSION,
        mandate_type: 'INTENT_MANDATE' as const,
        mandate_id: 'im_test_cap',
        principal: {
          user_id: 'usr_david_001',
          paypal_payer_id: 'PP-PAYER-884930',
          public_key: principalKeys.publicKeyHex,
          public_key_pem: principalKeys.publicKeyPem,
        },
        constraints: {
          max_amount: 30.0,
          currency: 'USD' as const,
          allowed_settlement_rails: ['PAYPAL_BALANCE'] as const,
          permitted_service_types: ['DATA_EXTRACTION'],
          valid_from: validFrom,
          valid_until: validUntil,
        },
      };
      const signature = signWithEd25519(raw, principalKeys.privateKeyPem);
      buyerAgent.bindIntentMandate({ ...raw, signature });

      // Attempt to negotiate with price exceeding $30 limit (e.g. $5,000)
      const result = await buyerAgent.negotiateWithSeller(sellerAgent, { excessivePriceMode: true });

      expect(result.success).toBe(false);
      expect(result.quarantinedThreat?.type).toBe('SPEND_CAP_EXCEEDED');
    });
  });

  // --- 5. PayPal Two-Phase Escrow (AUTHORIZE -> CAPTURE) Lifecycle ---
  describe('5. PayPal Orders v2 Two-Phase Escrow & Oracle Settlement', () => {
    it('should complete full 12-step handshake: lock escrow, verify deliverable, and capture payment', async () => {
      const validFrom = new Date(Date.now() - 10000).toISOString();
      const validUntil = new Date(Date.now() + 3600000).toISOString();

      const raw = {
        ap2_version: AP2_VERSION,
        mandate_type: 'INTENT_MANDATE' as const,
        mandate_id: 'im_full_lifecycle',
        principal: {
          user_id: 'usr_david_001',
          paypal_payer_id: 'PP-PAYER-884930',
          public_key: principalKeys.publicKeyHex,
          public_key_pem: principalKeys.publicKeyPem,
        },
        constraints: {
          max_amount: 30.0,
          currency: 'USD' as const,
          allowed_settlement_rails: ['PAYPAL_BALANCE'] as const,
          permitted_service_types: ['DATA_EXTRACTION', 'INFERENCE_API'],
          valid_from: validFrom,
          valid_until: validUntil,
        },
      };
      const signature = signWithEd25519(raw, principalKeys.privateKeyPem);
      const intentMandate: IntentMandate = { ...raw, signature };
      buyerAgent.bindIntentMandate(intentMandate);

      // Negotiate legitimate $25.00 cart mandate
      const neg = await buyerAgent.negotiateWithSeller(sellerAgent);
      expect(neg.success).toBe(true);
      expect(neg.cartMandate).toBeDefined();

      const cartMandate = neg.cartMandate!;

      // Lock Escrow on PayPal Rails
      const lockRes = await fiduciary.lockEscrow(intentMandate, cartMandate, buyerAgent.keyPair.publicKeyPem);
      expect(lockRes.success).toBe(true);
      expect(lockRes.row?.state).toBe(EscrowState.ESCROW_LOCKED);
      expect(lockRes.row?.authorizationId).toBeDefined();

      // Seller executes compute & generates deliverable
      const deliverable = await sellerAgent.executeAndDeliver(cartMandate);
      expect(deliverable.proof).toBeDefined();
      expect(deliverable.recordCount).toBe(500);

      // Oracle verifies SHA-256 deliverable and captures PayPal escrow
      const settleRes = await fiduciary.verifyAndSettle(
        lockRes.transactionId,
        deliverable.proof,
        deliverable.dataPayload
      );

      expect(settleRes.success).toBe(true);
      expect(settleRes.state).toBe(EscrowState.SETTLED);
      expect(settleRes.row.oracleVerified).toBe(true);
      expect(settleRes.row.captureId).toBeDefined();
    });

    it('should reject tampered deliverable and auto-refund buyer (void authorization)', async () => {
      const validFrom = new Date(Date.now() - 10000).toISOString();
      const validUntil = new Date(Date.now() + 3600000).toISOString();

      const raw = {
        ap2_version: AP2_VERSION,
        mandate_type: 'INTENT_MANDATE' as const,
        mandate_id: 'im_tamper_test',
        principal: {
          user_id: 'usr_david_001',
          paypal_payer_id: 'PP-PAYER-884930',
          public_key: principalKeys.publicKeyHex,
          public_key_pem: principalKeys.publicKeyPem,
        },
        constraints: {
          max_amount: 30.0,
          currency: 'USD' as const,
          allowed_settlement_rails: ['PAYPAL_BALANCE'] as const,
          permitted_service_types: ['DATA_EXTRACTION'],
          valid_from: validFrom,
          valid_until: validUntil,
        },
      };
      const signature = signWithEd25519(raw, principalKeys.privateKeyPem);
      const intentMandate: IntentMandate = { ...raw, signature };
      buyerAgent.bindIntentMandate(intentMandate);

      const neg = await buyerAgent.negotiateWithSeller(sellerAgent);
      const cartMandate = neg.cartMandate!;

      const lockRes = await fiduciary.lockEscrow(intentMandate, cartMandate, buyerAgent.keyPair.publicKeyPem);
      expect(lockRes.success).toBe(true);

      // Seller delivers tampered/corrupted data
      const deliverable = await sellerAgent.executeAndDeliver(cartMandate, { tamperDeliverable: true });

      // Oracle verifies -> must detect mismatch and reject!
      const settleRes = await fiduciary.verifyAndSettle(
        lockRes.transactionId,
        deliverable.proof,
        deliverable.dataPayload
      );

      expect(settleRes.success).toBe(false);
      expect(settleRes.state).toBe(EscrowState.SETTLEMENT_REJECTED);
      expect(settleRes.row.oracleVerified).toBe(false);
      expect(settleRes.errors.some((e) => e.includes('Mismatch'))).toBe(true);
    });

    it('should auto-refund buyer if SLA delivery timeout is exceeded', async () => {
      const validFrom = new Date(Date.now() - 10000).toISOString();
      const validUntil = new Date(Date.now() + 3600000).toISOString();

      const raw = {
        ap2_version: AP2_VERSION,
        mandate_type: 'INTENT_MANDATE' as const,
        mandate_id: 'im_timeout_test',
        principal: {
          user_id: 'usr_david_001',
          paypal_payer_id: 'PP-PAYER-884930',
          public_key: principalKeys.publicKeyHex,
          public_key_pem: principalKeys.publicKeyPem,
        },
        constraints: {
          max_amount: 30.0,
          currency: 'USD' as const,
          allowed_settlement_rails: ['PAYPAL_BALANCE'] as const,
          permitted_service_types: ['DATA_EXTRACTION'],
          valid_from: validFrom,
          valid_until: validUntil,
        },
      };
      const signature = signWithEd25519(raw, principalKeys.privateKeyPem);
      const intentMandate: IntentMandate = { ...raw, signature };
      buyerAgent.bindIntentMandate(intentMandate);

      const neg = await buyerAgent.negotiateWithSeller(sellerAgent);
      const cartMandate = neg.cartMandate!;

      const lockRes = await fiduciary.lockEscrow(intentMandate, cartMandate, buyerAgent.keyPair.publicKeyPem);
      const deliverable = await sellerAgent.executeAndDeliver(cartMandate);

      // Settle with SLA timeout triggered
      const settleRes = await fiduciary.verifyAndSettle(
        lockRes.transactionId,
        deliverable.proof,
        deliverable.dataPayload,
        { simulateSlaTimeout: true }
      );

      expect(settleRes.success).toBe(false);
      expect(settleRes.state).toBe(EscrowState.ESCROW_VOIDED);
      expect(settleRes.errors[0]).toContain('SLA Delivery timeout');
    });
  });

  // --- 6. PYUSD Stablecoin Rail Emulation ---
  describe('6. PYUSD Stablecoin Settlement Rail & Partner Attribution', () => {
    it('should include official PayPal Partner Attribution ID on all operations', () => {
      expect(payPalEscrowService.bnCode).toBe('FLAVORsb-hrqjx53499097_MP');
    });

    it('should execute ultra-low latency PYUSD settlement with on-chain tx hash telemetry and block hashes', async () => {
      const validFrom = new Date(Date.now() - 10000).toISOString();
      const validUntil = new Date(Date.now() + 3600000).toISOString();

      const raw = {
        ap2_version: AP2_VERSION,
        mandate_type: 'INTENT_MANDATE' as const,
        mandate_id: 'im_pyusd_test',
        principal: {
          user_id: 'usr_david_001',
          paypal_payer_id: 'PP-PAYER-884930',
          public_key: principalKeys.publicKeyHex,
          public_key_pem: principalKeys.publicKeyPem,
        },
        constraints: {
          max_amount: 30.0,
          currency: 'USD' as const,
          allowed_settlement_rails: ['PYUSD'] as const,
          permitted_service_types: ['DATA_EXTRACTION'],
          valid_from: validFrom,
          valid_until: validUntil,
        },
      };
      const signature = signWithEd25519(raw, principalKeys.privateKeyPem);
      const intentMandate: IntentMandate = { ...raw, signature };
      buyerAgent.bindIntentMandate(intentMandate);

      const neg = await buyerAgent.negotiateWithSeller(sellerAgent, { preferredRail: 'PYUSD' });
      expect(neg.cartMandate?.settlement_rail).toBe('PYUSD');

      const lockRes = await fiduciary.lockEscrow(intentMandate, neg.cartMandate!, buyerAgent.keyPair.publicKeyPem);
      const deliverable = await sellerAgent.executeAndDeliver(neg.cartMandate!);

      const settleRes = await fiduciary.verifyAndSettle(
        lockRes.transactionId,
        deliverable.proof,
        deliverable.dataPayload
      );

      expect(settleRes.success).toBe(true);
      expect(settleRes.state).toBe(EscrowState.SETTLED);
      expect(settleRes.row.pyusdTxHash).toBeDefined();
      expect(settleRes.row.pyusdTxHash).toMatch(/^0x[a-f0-9]{64}$/);

      // Verify PYUSD telemetry in audit ledger
      const audit = payPalEscrowService.getAuditLedger();
      const pyusdAudit = audit.find(a => a.action === 'PYUSD_SETTLEMENT');
      expect(pyusdAudit).toBeDefined();
      expect(pyusdAudit?.partnerAttributionId).toBe('FLAVORsb-hrqjx53499097_MP');
      expect(pyusdAudit?.details?.blockNumber).toBeGreaterThan(20000000);
    });
  });

  // --- 7. Human Arbiter Manual Override ---
  describe('7. Human Arbiter Manual Override', () => {
    it('should allow a human arbiter to manually override and release escrow to seller', async () => {
      const validFrom = new Date(Date.now() - 10000).toISOString();
      const validUntil = new Date(Date.now() + 3600000).toISOString();

      const raw = {
        ap2_version: AP2_VERSION,
        mandate_type: 'INTENT_MANDATE' as const,
        mandate_id: 'im_arb_test',
        principal: {
          user_id: 'usr_david_001',
          paypal_payer_id: 'PP-PAYER-884930',
          public_key: principalKeys.publicKeyHex,
          public_key_pem: principalKeys.publicKeyPem,
        },
        constraints: {
          max_amount: 30.0,
          currency: 'USD' as const,
          allowed_settlement_rails: ['PAYPAL_BALANCE'] as const,
          permitted_service_types: ['DATA_EXTRACTION'],
          valid_from: validFrom,
          valid_until: validUntil,
        },
      };
      const signature = signWithEd25519(raw, principalKeys.privateKeyPem);
      buyerAgent.bindIntentMandate({ ...raw, signature });

      const neg = await buyerAgent.negotiateWithSeller(sellerAgent);
      const lockRes = await fiduciary.lockEscrow({ ...raw, signature }, neg.cartMandate!, buyerAgent.keyPair.publicKeyPem);

      // Human arbiter inspects dispute and manually releases
      const updatedRow = await fiduciary.manualArbitrationOverride(
        lockRes.transactionId,
        'RELEASE_TO_SELLER',
        'Human principal verified data delivery offline.'
      );

      expect(updatedRow.state).toBe(EscrowState.SETTLED);
      expect(updatedRow.disputeNotes).toContain('RELEASE_TO_SELLER');
    });
  });
});
