/**
 * pyFides - Escrow Fiduciary Agent & Cryptographic Oracle
 * Impartial zero-trust system fiduciary operating on PayPal Sandbox rails.
 * 
 * Guarantees:
 * - Deterministic, non-hallucinatory execution
 * - Two-phase escrow commit via Orders v2 (intent=AUTHORIZE -> CAPTURE)
 * - Cryptographic SHA-256 Oracle deliverable verification
 * - Automated instant refund (void authorization) on deliverable tampering or SLA timeout
 * - Real-time state machine emission for AG Grid live ledger
 */

import {
  IntentMandate,
  CartMandate,
  SettlementProof,
  EscrowState,
  verifyIntentMandate,
  verifyCartMandate,
  verifySettlementProof,
  ValidationResult,
} from '../protocol/ap2-mandates.js';
import {
  payPalEscrowService,
  PayPalAuthorizationResponse,
  PayPalCaptureResponse,
  PyusdSettlementResponse,
} from '../services/paypal-service.js';

export interface LedgerTransactionRow {
  transactionId: string;
  cartId: string;
  intentId: string;
  buyerId: string;
  sellerId: string;
  sku: string;
  amount: number;
  currency: string;
  settlementRail: string;
  state: EscrowState;
  paypalOrderId?: string;
  authorizationId?: string;
  captureId?: string;
  pyusdTxHash?: string;
  deliverableSha256?: string;
  oracleVerified: boolean;
  slaTimeoutSeconds: number;
  latencyMs: number;
  createdAt: string;
  updatedAt: string;
  rawIntentMandate?: IntentMandate;
  rawCartMandate?: CartMandate;
  rawSettlementProof?: SettlementProof;
  disputeNotes?: string;
  receiptUrl?: string;
  paypalFee?: string;
}

export type EscrowEventListener = (event: {
  type: string;
  transaction: LedgerTransactionRow;
  message: string;
  timestamp: string;
}) => void;

export class EscrowFiduciaryAgent {
  public readonly agentId = 'fiduciary_paypal_oracle_007';
  private transactions: Map<string, LedgerTransactionRow> = new Map();
  private listeners: EscrowEventListener[] = [];

  constructor() {}

  /**
   * Register listener for real-time WebSocket / SSE updates (powers AG Grid & Cyber-HUD)
   */
  public subscribe(listener: EscrowEventListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private emitEvent(type: string, tx: LedgerTransactionRow, message: string): void {
    const event = {
      type,
      transaction: { ...tx },
      message,
      timestamp: new Date().toISOString(),
    };
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        console.error('Error emitting fiduciary event:', err);
      }
    }
  }

  /**
   * Retrieves all rows formatted for AG Grid
   */
  public getLedgerRows(): LedgerTransactionRow[] {
    return Array.from(this.transactions.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  /**
   * Retrieves a single transaction row
   */
  public getTransaction(txId: string): LedgerTransactionRow | undefined {
    return this.transactions.get(txId);
  }

  /**
   * Phase 1: Receive Mandates & Lock Escrow on PayPal Rails
   * 1. Verifies Intent Mandate (Ed25519 principal signature & expiration)
   * 2. Verifies Cart Mandate (Buyer & Seller signatures & spend caps)
   * 3. Calls PayPal Orders v2 create_order(intent='AUTHORIZE')
   * 4. Calls authorize_order() -> Locks funds in Escrow
   */
  public async lockEscrow(
    intent: IntentMandate,
    cart: CartMandate,
    buyerPublicKeyPemOrHex: string
  ): Promise<{ success: boolean; transactionId: string; errors: string[]; row?: LedgerTransactionRow }> {
    const startTime = Date.now();
    const txId = `TX-${Date.now().toString(36).toUpperCase()}-${cart.cart_id.substring(3, 8).toUpperCase()}`;
    const isoNow = new Date().toISOString();

    const row: LedgerTransactionRow = {
      transactionId: txId,
      cartId: cart.cart_id,
      intentId: intent.mandate_id,
      buyerId: intent.principal.user_id,
      sellerId: cart.seller.agent_id,
      sku: cart.line_items[0]?.sku || 'UNKNOWN',
      amount: cart.total_amount,
      currency: cart.currency,
      settlementRail: cart.settlement_rail,
      state: EscrowState.NEGOTIATING,
      oracleVerified: false,
      slaTimeoutSeconds: cart.sla_terms.timeout_seconds,
      latencyMs: 0,
      createdAt: isoNow,
      updatedAt: isoNow,
      rawIntentMandate: intent,
      rawCartMandate: cart,
    };
    this.transactions.set(txId, row);
    this.emitEvent('ESCROW_INITIATED', row, 'Mandates received for verification.');

    // 1. Verify Intent Mandate
    const intentValidation = verifyIntentMandate(intent);
    if (!intentValidation.valid) {
      row.state = EscrowState.SETTLEMENT_REJECTED;
      row.updatedAt = new Date().toISOString();
      this.emitEvent('INTENT_VERIFICATION_FAILED', row, `Intent Mandate rejected: ${intentValidation.errors.join('; ')}`);
      return { success: false, transactionId: txId, errors: intentValidation.errors, row };
    }

    // 2. Verify Cart Mandate
    const cartValidation = verifyCartMandate(cart, intent, buyerPublicKeyPemOrHex);
    if (!cartValidation.valid) {
      row.state = EscrowState.SETTLEMENT_REJECTED;
      row.updatedAt = new Date().toISOString();
      this.emitEvent('CART_VERIFICATION_FAILED', row, `Cart Mandate rejected: ${cartValidation.errors.join('; ')}`);
      return { success: false, transactionId: txId, errors: cartValidation.errors, row };
    }

    row.state = EscrowState.ESCROW_LOCKING;
    this.emitEvent('MANDATES_VERIFIED', row, 'Mandates cryptographically verified. Locking PayPal escrow.');

    try {
      // 3. PayPal Orders v2 Two-Phase Escrow: Create Order (intent=AUTHORIZE)
      const order = await payPalEscrowService.createEscrowOrder({
        cartId: cart.cart_id,
        amount: cart.total_amount,
        currency: cart.settlement_rail === 'PYUSD' ? 'PYUSD' : 'USD',
        description: `pyFides AP2 Escrow for ${cart.line_items[0]?.description || 'Dataset'}`,
        payerId: intent.principal.paypal_payer_id,
        payeeMerchantId: cart.seller.paypal_merchant_id,
      });

      row.paypalOrderId = order.id;

      // 4. Authorize Order (Escrow Lock)
      const auth = await payPalEscrowService.authorizeEscrowLock(order.id);
      row.authorizationId = auth.authorizationId;
      row.state = EscrowState.ESCROW_LOCKED;
      row.latencyMs = Date.now() - startTime;
      row.updatedAt = new Date().toISOString();

      this.emitEvent(
        'ESCROW_LOCKED',
        row,
        `PayPal Escrow locked ($${cart.total_amount.toFixed(2)} USD). Auth ID: ${auth.authorizationId}. Ready for Seller compute.`
      );

      return { success: true, transactionId: txId, errors: [], row };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      row.state = EscrowState.SETTLEMENT_REJECTED;
      row.updatedAt = new Date().toISOString();
      this.emitEvent('ESCROW_LOCK_ERROR', row, `PayPal API error: ${msg}`);
      return { success: false, transactionId: txId, errors: [msg], row };
    }
  }

  /**
   * Phase 2: Deliverable SLA Verification & Conditional Release / Auto-Refund
   * 1. Cryptographic Oracle verifies deliverable byte hash against Cart Mandate
   * 2. Checks Seller's Settlement Proof signature
   * 3. IF VALID: Invokes capture_order() on PayPal or settles PYUSD. Funds disburse to Seller.
   * 4. IF INVALID (tampered) OR TIMEOUT: Invokes void_authorization() on PayPal. Funds instantly restored to Buyer.
   */
  public async verifyAndSettle(
    transactionId: string,
    proof: SettlementProof,
    actualDeliverableData?: string | Buffer,
    options: { simulateSlaTimeout?: boolean } = {}
  ): Promise<{ success: boolean; state: EscrowState; errors: string[]; row: LedgerTransactionRow }> {
    const startTime = Date.now();
    const row = this.transactions.get(transactionId);
    if (!row || !row.rawCartMandate) {
      throw new Error(`Transaction ${transactionId} not found.`);
    }

    row.rawSettlementProof = proof;
    row.deliverableSha256 = proof.deliverable_sha256;
    row.state = EscrowState.ORACLE_VERIFYING;
    row.updatedAt = new Date().toISOString();
    this.emitEvent('ORACLE_VERIFICATION_STARTED', row, 'Cryptographic Oracle verifying deliverable digest.');

    // SLA Timeout check
    if (options.simulateSlaTimeout) {
      row.state = EscrowState.ESCROW_VOIDED;
      row.updatedAt = new Date().toISOString();
      if (row.authorizationId) {
        await payPalEscrowService.voidEscrowAuthorization(row.authorizationId, 'SLA_DELIVERY_TIMEOUT_EXCEEDED');
      }
      this.emitEvent(
        'ESCROW_TIMEOUT_VOIDED',
        row,
        `SLA delivery timeout exceeded (> ${row.slaTimeoutSeconds}s). PayPal Escrow voided. Buyer refunded.`
      );
      return {
        success: false,
        state: EscrowState.ESCROW_VOIDED,
        errors: [`SLA Delivery timeout exceeded (${row.slaTimeoutSeconds}s). Funds refunded.`],
        row,
      };
    }

    // Cryptographic Oracle Verification
    const proofValidation = verifySettlementProof(proof, row.rawCartMandate, actualDeliverableData);

    if (!proofValidation.valid) {
      // TAMPERED DELIVERABLE DETECTED: Auto-Refund Buyer!
      row.oracleVerified = false;
      row.state = EscrowState.SETTLEMENT_REJECTED;
      row.updatedAt = new Date().toISOString();

      if (row.authorizationId) {
        await payPalEscrowService.voidEscrowAuthorization(
          row.authorizationId,
          `CRYPTOGRAPHIC_DIGEST_MISMATCH: ${proofValidation.errors.join('; ')}`
        );
      }

      this.emitEvent(
        'ORACLE_VERIFICATION_FAILED',
        row,
        `Oracle rejected deliverable: ${proofValidation.errors.join('; ')}. PayPal authorization voided.`
      );

      return {
        success: false,
        state: EscrowState.SETTLEMENT_REJECTED,
        errors: proofValidation.errors,
        row,
      };
    }

    // ORACLE VERIFIED: Conditional Release of Escrow Funds
    row.oracleVerified = true;
    row.state = EscrowState.ORACLE_VERIFIED;
    this.emitEvent('ORACLE_VERIFIED', row, 'Deliverable SHA-256 digest mathematically verified. Executing settlement.');

    try {
      if (row.settlementRail === 'PYUSD') {
        // PYUSD Stablecoin Rail Emulation
        const pyusdRes = await payPalEscrowService.settlePyusdMicrotransaction(
          row.amount,
          '0xBuyerAgentAlphaWalletEscrow884930',
          '0xSellerAgentBetaWallet7721',
          row.cartId
        );

        row.pyusdTxHash = pyusdRes.txHash;
        row.state = EscrowState.SETTLED;
        row.latencyMs = Date.now() - startTime + row.latencyMs;
        row.updatedAt = new Date().toISOString();

        this.emitEvent(
          'SETTLEMENT_COMPLETE',
          row,
          `PYUSD Stablecoin settled: ${pyusdRes.pyusdAmount} PYUSD transferred. Tx: ${pyusdRes.txHash.substring(0, 18)}... (Latency: ${pyusdRes.settlementLatencyMs}ms)`
        );
      } else {
        // PayPal Balance / Orders v2 CAPTURE
        if (!row.authorizationId) {
          throw new Error('Missing authorizationId for PayPal capture.');
        }

        const capture = await payPalEscrowService.captureEscrowFunds(row.authorizationId);
        row.captureId = capture.captureId;
        row.receiptUrl = capture.receiptUrl;
        row.paypalFee = capture.seller_receivable_breakdown?.paypal_fee?.value;
        row.state = EscrowState.SETTLED;
        row.latencyMs = Date.now() - startTime + row.latencyMs;
        row.updatedAt = new Date().toISOString();

        this.emitEvent(
          'SETTLEMENT_COMPLETE',
          row,
          `PayPal Capture successful: $${row.amount.toFixed(2)} USD disbursed to Seller. Capture ID: ${capture.captureId}.`
        );
      }

      return {
        success: true,
        state: EscrowState.SETTLED,
        errors: [],
        row,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      row.state = EscrowState.ARBITRATION_REQUESTED;
      row.updatedAt = new Date().toISOString();
      this.emitEvent('SETTLEMENT_ERROR', row, `Settlement execution failure: ${msg}. Flagged for arbitration.`);
      return {
        success: false,
        state: EscrowState.ARBITRATION_REQUESTED,
        errors: [msg],
        row,
      };
    }
  }

  /**
   * Human Principal / Arbiter Manual Override:
   * Enables human inspection and resolution for edge-case disputes.
   */
  public async manualArbitrationOverride(
    transactionId: string,
    decision: 'RELEASE_TO_SELLER' | 'REFUND_TO_BUYER',
    notes: string
  ): Promise<LedgerTransactionRow> {
    const row = this.transactions.get(transactionId);
    if (!row) {
      throw new Error(`Transaction ${transactionId} not found.`);
    }

    row.disputeNotes = `Arbitration Decision: ${decision}. Notes: ${notes} (at ${new Date().toISOString()})`;

    if (decision === 'RELEASE_TO_SELLER') {
      if (row.authorizationId && row.state !== EscrowState.SETTLED) {
        const capture = await payPalEscrowService.captureEscrowFunds(row.authorizationId);
        row.captureId = capture.captureId;
      }
      row.state = EscrowState.SETTLED;
    } else {
      if (row.authorizationId && row.state !== EscrowState.ESCROW_VOIDED) {
        await payPalEscrowService.voidEscrowAuthorization(row.authorizationId, `HUMAN_ARBITRATION_REFUND: ${notes}`);
      }
      row.state = EscrowState.ESCROW_VOIDED;
    }

    row.updatedAt = new Date().toISOString();
    this.emitEvent('ARBITRATION_RESOLVED', row, `Human Arbiter executed ${decision}.`);
    return row;
  }

  /**
   * Record a quarantined adversarial attempt / spending cap violation
   */
  public recordQuarantined(params: {
    transactionId?: string;
    sku: string;
    amount: number;
    currency?: string;
    settlementRail?: string;
    intentMandate?: IntentMandate;
    disputeNotes?: string;
    sellerId?: string;
  }): LedgerTransactionRow {
    const txId = params.transactionId || `TX-${Date.now().toString(36).toUpperCase()}-SEC`;
    const isoNow = new Date().toISOString();
    const row: LedgerTransactionRow = {
      transactionId: txId,
      cartId: `cm_quarantined_${Date.now().toString(36)}`,
      intentId: params.intentMandate?.mandate_id || `im_quarantined_${Date.now().toString(36)}`,
      buyerId: params.intentMandate?.principal.user_id || 'usr_david_001',
      sellerId: params.sellerId || 'seller.adversarial',
      sku: params.sku,
      amount: params.amount,
      currency: params.currency || 'USD',
      settlementRail: params.settlementRail || 'PAYPAL_BALANCE',
      state: EscrowState.SETTLEMENT_REJECTED,
      oracleVerified: false,
      slaTimeoutSeconds: 0,
      latencyMs: 14,
      createdAt: isoNow,
      updatedAt: isoNow,
      rawIntentMandate: params.intentMandate,
      disputeNotes: params.disputeNotes || 'Adversarial Prompt Injection Quarantined by OWASP Guard',
    };
    this.transactions.set(txId, row);
    this.emitEvent('THREAT_QUARANTINED', row, 'Transaction quarantined: Prompt injection or mandate cap bypass blocked.');
    return row;
  }
}

export const escrowFiduciary = new EscrowFiduciaryAgent();
