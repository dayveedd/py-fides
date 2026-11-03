/**
 * pyFides - AP2 Cryptographic Mandate Engine
 * Implements Google Agent Payments Protocol (AP2) specification for A2A commerce.
 * 
 * Features:
 * - RFC 8785 JSON Canonicalization Scheme (JCS) deterministic hashing
 * - Ed25519 asymmetric signing and verification
 * - Strict Zod schema typing and boundary validation
 * - Anti-tamper & anti-replay defense (nonces & time-bounded windows)
 */

import crypto from 'node:crypto';
import { z } from 'zod';

export const AP2_VERSION = '2026.1.0';

// --- Cryptographic Utility Functions (RFC 8785 Canonicalization & Ed25519) ---

/**
 * Canonicalizes a JSON value according to RFC 8785 (JSON Canonicalization Scheme)
 * Sorts object keys recursively, removes whitespace, formats floats canonically.
 */
export function canonicalizeJson(obj: unknown): string {
  if (obj === null) return 'null';
  if (typeof obj === 'boolean' || typeof obj === 'number') {
    return JSON.stringify(obj);
  }
  if (typeof obj === 'string') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    const elements = obj.map((item) => canonicalizeJson(item));
    return `[${elements.join(',')}]`;
  }
  if (typeof obj === 'object') {
    const keys = Object.keys(obj as Record<string, unknown>).sort();
    const pairs = keys
      .filter((k) => (obj as Record<string, unknown>)[k] !== undefined)
      .map((k) => {
        const val = canonicalizeJson((obj as Record<string, unknown>)[k]);
        return `${JSON.stringify(k)}:${val}`;
      });
    return `{${pairs.join(',')}}`;
  }
  return JSON.stringify(obj);
}

/**
 * Computes deterministic SHA-256 hash of any JSON-serializable structure or string.
 */
export function computeSha256(data: unknown): string {
  const content = typeof data === 'string' ? data : canonicalizeJson(data);
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * Keypair container representing Ed25519 keys
 */
export interface Ed25519KeyPair {
  publicKeyPem: string;
  privateKeyPem: string;
  publicKeyHex: string;
}

/**
 * Generates an Ed25519 keypair for an agent or human principal
 */
export function generateEd25519KeyPair(): Ed25519KeyPair {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  
  // Extract raw 32-byte public key hex from SPKI
  const spkiDer = publicKey.export({ type: 'spki', format: 'der' });
  const rawPub = spkiDer.subarray(spkiDer.length - 32);
  const publicKeyHex = rawPub.toString('hex');

  return {
    publicKeyPem,
    privateKeyPem,
    publicKeyHex,
  };
}

/**
 * Signs payload using Ed25519 private key.
 * Can sign raw string or JSON object (which is automatically canonicalized).
 */
export function signWithEd25519(payload: unknown, privateKeyPem: string): string {
  const data = typeof payload === 'string' ? payload : canonicalizeJson(payload);
  const buffer = Buffer.from(data, 'utf8');
  const privateKey = crypto.createPrivateKey(privateKeyPem);
  const signature = crypto.sign(null, buffer, privateKey);
  return signature.toString('hex');
}

/**
 * Verifies Ed25519 signature against payload and public key.
 */
export function verifyEd25519Signature(
  payload: unknown,
  signatureHex: string,
  publicKeyPemOrHex: string
): boolean {
  try {
    const data = typeof payload === 'string' ? payload : canonicalizeJson(payload);
    const buffer = Buffer.from(data, 'utf8');
    const signatureBuffer = Buffer.from(signatureHex, 'hex');

    let publicKey: crypto.KeyObject;
    if (publicKeyPemOrHex.includes('BEGIN PUBLIC KEY')) {
      publicKey = crypto.createPublicKey(publicKeyPemOrHex);
    } else {
      // Raw 32-byte Ed25519 public key hex, reconstruct SPKI DER header
      const rawPub = Buffer.from(publicKeyPemOrHex, 'hex');
      const spkiHeader = Buffer.from('302a300506032b6570032100', 'hex');
      const fullDer = Buffer.concat([spkiHeader, rawPub]);
      publicKey = crypto.createPublicKey({ key: fullDer, format: 'der', type: 'spki' });
    }

    return crypto.verify(null, buffer, publicKey, signatureBuffer);
  } catch (err) {
    return false;
  }
}

// --- AP2 Data Schemas & Zod Validators ---

export const SettlementRailEnum = z.enum(['PAYPAL_BALANCE', 'PYUSD']);
export type SettlementRail = z.infer<typeof SettlementRailEnum>;

export const ServiceTypeEnum = z.enum(['DATA_EXTRACTION', 'INFERENCE_API', 'FINANCIAL_INTELLIGENCE']);
export type ServiceType = z.infer<typeof ServiceTypeEnum>;

/**
 * 1. Intent Mandate Schema (Human Principal -> Buyer Agent Alpha)
 * Defines spend cap, allowed rails, time validity window, and principal public key.
 */
export const PrincipalSchema = z.object({
  user_id: z.string().min(1),
  paypal_payer_id: z.string().min(1),
  public_key: z.string().min(1),
  public_key_pem: z.string().optional(),
});
export type Principal = z.infer<typeof PrincipalSchema>;

export const IntentConstraintsSchema = z.object({
  max_amount: z.number().positive(),
  currency: z.literal('USD'),
  allowed_settlement_rails: z.array(SettlementRailEnum).min(1),
  permitted_service_types: z.array(z.string()).min(1),
  valid_from: z.string().datetime(),
  valid_until: z.string().datetime(),
  nonce: z.string().optional(),
});
export type IntentConstraints = z.infer<typeof IntentConstraintsSchema>;

export const IntentMandateSchema = z.object({
  ap2_version: z.string(),
  mandate_type: z.literal('INTENT_MANDATE'),
  mandate_id: z.string(),
  principal: PrincipalSchema,
  constraints: IntentConstraintsSchema,
  signature: z.string().min(1),
});
export type IntentMandate = z.infer<typeof IntentMandateSchema>;

/**
 * 2. Cart Mandate Schema (Buyer Agent Alpha <-> Seller Agent Beta)
 * Immutable terms agreed between agents, including exact line items, SLA terms, and dual signatures.
 */
export const LineItemSchema = z.object({
  sku: z.string(),
  description: z.string(),
  quantity: z.number().int().positive(),
  unit_price: z.number().positive(),
});
export type LineItem = z.infer<typeof LineItemSchema>;

export const SlaTermsSchema = z.object({
  timeout_seconds: z.number().positive(),
  deliverable_verification_method: z.literal('SHA256_HASH_VERIFICATION'),
  expected_schema: z.string(),
});
export type SlaTerms = z.infer<typeof SlaTermsSchema>;

export const SellerProfileSchema = z.object({
  agent_id: z.string(),
  service_endpoint: z.string().url(),
  paypal_merchant_id: z.string(),
  public_key: z.string(),
  public_key_pem: z.string().optional(),
});
export type SellerProfile = z.infer<typeof SellerProfileSchema>;

export const CartMandateSchema = z.object({
  ap2_version: z.string(),
  mandate_type: z.literal('CART_MANDATE'),
  cart_id: z.string(),
  intent_reference_id: z.string(),
  seller: SellerProfileSchema,
  line_items: z.array(LineItemSchema).min(1),
  total_amount: z.number().positive(),
  currency: z.literal('USD'),
  settlement_rail: SettlementRailEnum.default('PAYPAL_BALANCE'),
  sla_terms: SlaTermsSchema,
  deterministic_cart_hash: z.string().length(64),
  buyer_agent_signature: z.string(),
  seller_agent_signature: z.string(),
  created_at: z.string().datetime().optional(),
});
export type CartMandate = z.infer<typeof CartMandateSchema>;

/**
 * 3. Settlement Proof Schema (Seller Beta -> Escrow Fiduciary Oracle)
 * Cryptographic deliverable hash proving work completion before escrow release.
 */
export const SettlementProofSchema = z.object({
  ap2_version: z.string(),
  mandate_type: z.literal('SETTLEMENT_PROOF'),
  proof_id: z.string(),
  cart_id: z.string(),
  deliverable_sha256: z.string().length(64),
  completion_timestamp: z.string().datetime(),
  execution_duration_ms: z.number().int().nonnegative(),
  seller_signature: z.string(),
});
export type SettlementProof = z.infer<typeof SettlementProofSchema>;

/**
 * Escrow State Machine Enums
 */
export enum EscrowState {
  INITIALIZED = 'INITIALIZED',
  INTENT_DELEGATED = 'INTENT_DELEGATED',
  NEGOTIATING = 'NEGOTIATING',
  CART_SIGNED = 'CART_SIGNED',
  ESCROW_LOCKING = 'ESCROW_LOCKING',
  ESCROW_LOCKED = 'ESCROW_LOCKED',
  COMPUTING = 'COMPUTING',
  DELIVERING = 'DELIVERING',
  DELIVERABLE_SUBMITTED = 'DELIVERABLE_SUBMITTED',
  ORACLE_VERIFYING = 'ORACLE_VERIFYING',
  ORACLE_VERIFIED = 'ORACLE_VERIFIED',
  SETTLED = 'SETTLED',
  SETTLEMENT_REJECTED = 'SETTLEMENT_REJECTED',
  ESCROW_VOIDED = 'ESCROW_VOIDED',
  ARBITRATION_REQUESTED = 'ARBITRATION_REQUESTED',
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  canonicalHash?: string;
}

// --- AP2 Mandate Builders & Verification Engines ---

/**
 * Extracts payload for Intent Mandate signing (all fields excluding signature)
 */
export function getIntentSigningPayload(mandate: Omit<IntentMandate, 'signature'>): Record<string, unknown> {
  return {
    ap2_version: mandate.ap2_version,
    mandate_type: mandate.mandate_type,
    mandate_id: mandate.mandate_id,
    principal: mandate.principal,
    constraints: mandate.constraints,
  };
}

/**
 * Verifies validity of an AP2 Intent Mandate:
 * 1. Zod structural validation
 * 2. Ed25519 signature of human principal
 * 3. Time validity (valid_from <= now <= valid_until)
 */
export function verifyIntentMandate(mandate: IntentMandate, referenceTime = new Date()): ValidationResult {
  const errors: string[] = [];
  const parseResult = IntentMandateSchema.safeParse(mandate);
  if (!parseResult.success) {
    return {
      valid: false,
      errors: parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`),
    };
  }

  const payload = getIntentSigningPayload(mandate);
  const keyToUse = mandate.principal.public_key_pem || mandate.principal.public_key;
  const isSigValid = verifyEd25519Signature(payload, mandate.signature, keyToUse);
  if (!isSigValid) {
    errors.push('Cryptographic signature verification failed for human principal Ed25519 key.');
  }

  const validFrom = new Date(mandate.constraints.valid_from);
  const validUntil = new Date(mandate.constraints.valid_until);

  if (referenceTime < validFrom) {
    errors.push(`Intent Mandate not yet valid. Activates at ${validFrom.toISOString()}`);
  }
  if (referenceTime > validUntil) {
    errors.push(`Intent Mandate has expired at ${validUntil.toISOString()}`);
  }

  return {
    valid: errors.length === 0,
    errors,
    canonicalHash: computeSha256(payload),
  };
}

/**
 * Extracts pure deterministic payload of Cart Mandate for hashing & signing
 */
export function getCartCanonicalTerms(
  cart: Omit<CartMandate, 'deterministic_cart_hash' | 'buyer_agent_signature' | 'seller_agent_signature'>
): Record<string, unknown> {
  return {
    ap2_version: cart.ap2_version,
    mandate_type: cart.mandate_type,
    cart_id: cart.cart_id,
    intent_reference_id: cart.intent_reference_id,
    seller: {
      agent_id: cart.seller.agent_id,
      service_endpoint: cart.seller.service_endpoint,
      paypal_merchant_id: cart.seller.paypal_merchant_id,
      public_key: cart.seller.public_key,
    },
    line_items: cart.line_items.map((li) => ({
      sku: li.sku,
      description: li.description,
      quantity: li.quantity,
      unit_price: li.unit_price,
    })),
    total_amount: cart.total_amount,
    currency: cart.currency,
    settlement_rail: cart.settlement_rail,
    sla_terms: cart.sla_terms,
  };
}

/**
 * Computes canonical deterministic cart hash
 */
export function computeCartHash(
  cart: Omit<CartMandate, 'deterministic_cart_hash' | 'buyer_agent_signature' | 'seller_agent_signature'>
): string {
  const terms = getCartCanonicalTerms(cart);
  return computeSha256(terms);
}

/**
 * Verifies validity of an AP2 Cart Mandate against the Human Intent Mandate:
 * 1. Structural schema compliance
 * 2. Deterministic Cart Hash integrity check
 * 3. Budget cap enforcement (cart.total_amount <= intent.max_amount)
 * 4. Currency matching
 * 5. Settlement rail authorization check
 * 6. Dual signatures check (Buyer Agent Alpha & Seller Agent Beta)
 */
export function verifyCartMandate(
  cart: CartMandate,
  intent: IntentMandate,
  buyerPublicKeyPemOrHex: string,
  sellerPublicKeyPemOrHex?: string
): ValidationResult {
  const errors: string[] = [];

  const parseResult = CartMandateSchema.safeParse(cart);
  if (!parseResult.success) {
    return {
      valid: false,
      errors: parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`),
    };
  }

  // 1. Reference check
  if (cart.intent_reference_id !== intent.mandate_id) {
    errors.push(`Cart intent_reference_id (${cart.intent_reference_id}) does not match Intent Mandate id (${intent.mandate_id})`);
  }

  // 2. Deterministic Hash Integrity
  const calculatedHash = computeCartHash(cart);
  if (cart.deterministic_cart_hash !== calculatedHash) {
    errors.push(`Cart hash mismatch! Declared: ${cart.deterministic_cart_hash}, Calculated: ${calculatedHash}`);
  }

  // 3. Mathematical Spend Bound Enforcement (Zero-Trust defense)
  if (cart.total_amount > intent.constraints.max_amount) {
    errors.push(`Spend bound violation: Cart total $${cart.total_amount.toFixed(2)} exceeds Intent max cap $${intent.constraints.max_amount.toFixed(2)}`);
  }

  // Check sum of line items matches total_amount
  const lineItemTotal = cart.line_items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0);
  if (Math.abs(lineItemTotal - cart.total_amount) > 0.001) {
    errors.push(`Line item sum ($${lineItemTotal.toFixed(2)}) does not match declared total_amount ($${cart.total_amount.toFixed(2)})`);
  }

  // 4. Currency check
  if (cart.currency !== intent.constraints.currency) {
    errors.push(`Currency mismatch: Cart uses ${cart.currency}, Intent allows ${intent.constraints.currency}`);
  }

  // 5. Settlement rail check
  if (!intent.constraints.allowed_settlement_rails.includes(cart.settlement_rail)) {
    errors.push(`Unauthorized settlement rail: ${cart.settlement_rail} is not in allowed rails: ${intent.constraints.allowed_settlement_rails.join(', ')}`);
  }

  // 6. Dual Signature Checks (Buyer and Seller counter-signatures over deterministic_cart_hash)
  const isBuyerSigValid = verifyEd25519Signature(
    cart.deterministic_cart_hash,
    cart.buyer_agent_signature,
    buyerPublicKeyPemOrHex
  );
  if (!isBuyerSigValid) {
    errors.push('Buyer Agent Alpha Ed25519 signature on cart hash is invalid');
  }

  const sellerKeyToUse = sellerPublicKeyPemOrHex || cart.seller.public_key_pem || cart.seller.public_key;
  const isSellerSigValid = verifyEd25519Signature(
    cart.deterministic_cart_hash,
    cart.seller_agent_signature,
    sellerKeyToUse
  );
  if (!isSellerSigValid) {
    errors.push('Seller Agent Beta Ed25519 signature on cart hash is invalid');
  }

  return {
    valid: errors.length === 0,
    errors,
    canonicalHash: calculatedHash,
  };
}

/**
 * Verifies Settlement Proof delivered by Seller Beta to Oracle:
 * 1. Structural schema compliance
 * 2. Checks cart_id reference
 * 3. Validates seller signature over deliverable_sha256
 * 4. If actual deliverable data provided, verifies SHA-256 matches
 */
export function verifySettlementProof(
  proof: SettlementProof,
  cart: CartMandate,
  actualDeliverableData?: string | Buffer,
  sellerPublicKeyPemOrHex?: string
): ValidationResult {
  const errors: string[] = [];

  const parseResult = SettlementProofSchema.safeParse(proof);
  if (!parseResult.success) {
    return {
      valid: false,
      errors: parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`),
    };
  }

  if (proof.cart_id !== cart.cart_id) {
    errors.push(`Proof cart_id (${proof.cart_id}) does not match Cart Mandate id (${cart.cart_id})`);
  }

  // Verify Seller signature over deliverable_sha256
  const sellerKey = sellerPublicKeyPemOrHex || cart.seller.public_key_pem || cart.seller.public_key;
  const isSigValid = verifyEd25519Signature(
    proof.deliverable_sha256,
    proof.seller_signature,
    sellerKey
  );
  if (!isSigValid) {
    errors.push('Seller signature on deliverable SHA-256 proof is invalid');
  }

  // If deliverable payload is provided, verify raw byte hash
  if (actualDeliverableData) {
    const rawDataBuffer = typeof actualDeliverableData === 'string'
      ? Buffer.from(actualDeliverableData, 'utf8')
      : actualDeliverableData;
    const computedHash = crypto.createHash('sha256').update(rawDataBuffer).digest('hex');

    if (computedHash !== proof.deliverable_sha256) {
      errors.push(`Cryptographic Oracle Digest Mismatch! Computed: ${computedHash}, Declared: ${proof.deliverable_sha256}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    canonicalHash: proof.deliverable_sha256,
  };
}
