/**
 * pyFides - APIMatic Dynamic Discovery & Context Plugin Engine
 * Ingests OpenAPI 3.1 specifications of Seller agents, automatically synthesizing
 * type-safe MCP tools, function-calling schemas, and SLA metadata for Buyer Agent Alpha.
 * 
 * Compliant with APIMatic Context Plugin & Docs-as-Code standards.
 */

import { z } from 'zod';

export interface OpenApiEndpoint {
  path: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  summary: string;
  description: string;
  operationId: string;
  parameters?: Array<{
    name: string;
    in: 'query' | 'header' | 'path' | 'body';
    required: boolean;
    schema: Record<string, unknown>;
    description?: string;
  }>;
  requestBody?: {
    required?: boolean;
    content: Record<string, { schema: Record<string, unknown> }>;
  };
  responses: Record<string, { description: string; content?: Record<string, { schema: Record<string, unknown> }> }>;
  xSlaRequirements?: {
    maxLatencyMs: number;
    deliverableHashAlgorithm: string;
    pricingModel: {
      sku: string;
      unitPriceUsd: number;
      minQuantity: number;
      maxQuantity: number;
    };
  };
}

export interface OpenApiSpec {
  openapi: string;
  info: {
    title: string;
    version: string;
    description: string;
    contact?: { name: string; url: string; email: string };
  };
  servers: Array<{ url: string; description?: string }>;
  paths: Record<string, Record<string, unknown>>;
  components?: {
    schemas?: Record<string, unknown>;
    securitySchemes?: Record<string, unknown>;
  };
}

export interface SynthesizedMcpTool {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required: string[];
  };
  execute: (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
  slaMetadata?: {
    sku: string;
    unitPrice: number;
    timeoutSeconds: number;
    verificationMethod: string;
  };
}

export interface DiscoveredServiceContract {
  serviceId: string;
  title: string;
  version: string;
  baseUrl: string;
  endpoint: string;
  description: string;
  sku: string;
  standardPriceUsd: number;
  slaTimeoutSeconds: number;
  verificationMethod: string;
  mcpTools: SynthesizedMcpTool[];
  openApiSpec: OpenApiSpec;
}

/**
 * 1. Financial Sentiment Dataset OpenAPI 3.1 specification ($25.00 USD / PYUSD)
 */
export const FINANCIAL_SENTIMENT_OPENAPI_SPEC: OpenApiSpec = {
  openapi: '3.1.0',
  info: {
    title: 'AlphaBeta Financial Sentiment Intelligence Service',
    version: '2.4.0',
    description: 'High-frequency institutional sentiment signals and normalized SEC/news sentiment vectors for machine-to-machine algorithmic trading.',
    contact: {
      name: 'Agent Beta Seller Services',
      url: 'https://api.seller.ai',
      email: 'agent-beta@seller.ai',
    },
  },
  servers: [
    {
      url: 'https://api.seller.ai/v2',
      description: 'Production A2A Service Endpoint',
    },
  ],
  paths: {
    '/datasets/financial-sentiment-q4': {
      post: {
        operationId: 'requestFinancialSentimentDataset',
        summary: 'Request high-fidelity financial sentiment dataset',
        description: 'Computes normalized Q4 sentiment metrics across 5,000 equity tickers with timestamped source hashes.',
        parameters: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  quarters: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Quarter identifiers, e.g. ["2026-Q4"]',
                  },
                  recordCount: {
                    type: 'integer',
                    minimum: 1000,
                    maximum: 50000,
                    description: 'Number of normalized signal records',
                  },
                },
                required: ['quarters', 'recordCount'],
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Dataset computation complete and encrypted deliverable generated.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    deliverableId: { type: 'string' },
                    recordCount: { type: 'integer' },
                    sha256Digest: { type: 'string' },
                  },
                },
              },
            },
          },
        },
        xSlaRequirements: {
          maxLatencyMs: 180000,
          deliverableHashAlgorithm: 'SHA-256',
          pricingModel: {
            sku: 'FIN-SENTIMENT-Q4',
            unitPriceUsd: 25.0,
            minQuantity: 1,
            maxQuantity: 1,
          },
        },
      },
    },
    '/catalog/quote': {
      get: {
        operationId: 'getPricingQuote',
        summary: 'Query dynamic real-time price quotation',
        description: 'Returns real-time quote for SKU with escrow settlement terms.',
        parameters: [
          {
            name: 'sku',
            in: 'query',
            required: true,
            schema: { type: 'string' },
            description: 'SKU identifier to quote',
          },
        ],
        responses: {
          '200': {
            description: 'Price quote successfully retrieved',
          },
        },
      },
    },
  },
};

/**
 * 2. NVIDIA H100 GPU Inference Burst OpenAPI 3.1 specification ($28.00 USD)
 */
export const GPU_INFERENCE_OPENAPI_SPEC: OpenApiSpec = {
  openapi: '3.1.0',
  info: {
    title: 'NVIDIA TensorRT H100 GPU Inference Burst Service',
    version: '1.2.0',
    description: 'High-throughput clustered NVIDIA H100 SXM5 inference token allocation with CUDA stream telemetry and signed execution digest.',
    contact: {
      name: 'Compute Cluster Beta',
      url: 'https://compute.nvidia-cluster.agent.ai',
      email: 'compute@agent.ai',
    },
  },
  servers: [
    {
      url: 'https://compute.nvidia-cluster.agent.ai/v1',
      description: 'H100 Clustered Node Endpoint',
    },
  ],
  paths: {
    '/compute/h100-burst': {
      post: {
        operationId: 'requestH100ComputeBurst',
        summary: 'Allocate 100 H100 GPU Compute Units for burst LLM inference',
        description: 'Deploys dedicated 80GB H100 SXM5 instance, returning execution metrics and signed SHA-256 batch token receipt.',
        parameters: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  computeUnits: { type: 'integer', default: 100 },
                  precision: { type: 'string', enum: ['FP8', 'FP16', 'BF16'], default: 'FP8' },
                  modelArchitecture: { type: 'string', default: 'llama-3.3-70b-instruct' },
                },
                required: ['computeUnits'],
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Compute burst allocation executed successfully.',
          },
        },
        xSlaRequirements: {
          maxLatencyMs: 60000,
          deliverableHashAlgorithm: 'SHA-256',
          pricingModel: {
            sku: 'COMPUTE-H100-BURST',
            unitPriceUsd: 28.0,
            minQuantity: 1,
            maxQuantity: 1,
          },
        },
      },
    },
  },
};

/**
 * 3. Real-Time FinTech AP2 Gateway OpenAPI 3.1 specification ($15.00 USD)
 */
export const AP2_GATEWAY_OPENAPI_SPEC: OpenApiSpec = {
  openapi: '3.1.0',
  info: {
    title: 'Real-Time FinTech AP2 Gateway Protocol Service',
    version: '3.0.1',
    description: 'Machine-authenticated low-latency AP2 mandate routing proxy with cryptographic rate-limiting and instant dual-rail settlement hooks.',
    contact: {
      name: 'Gateway Protocol Agent',
      url: 'https://gateway.ap2-oracle.agent.ai',
      email: 'gateway@ap2-oracle.agent.ai',
    },
  },
  servers: [
    {
      url: 'https://gateway.ap2-oracle.agent.ai/v1',
      description: 'FinTech AP2 Proxy Gateway',
    },
  ],
  paths: {
    '/gateway/ap2-subscription': {
      post: {
        operationId: 'provisionGatewaySubscription',
        summary: 'Provision dedicated machine-to-machine AP2 gateway tunnel',
        description: 'Issues signed cryptographic proxy credentials with bounded spend telemetry and SLA monitoring.',
        parameters: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  tier: { type: 'string', default: 'ENTERPRISE_M2M' },
                  allowedTps: { type: 'integer', default: 500 },
                },
                required: ['tier'],
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Tunnel provisioned and cryptographic certificate issued.',
          },
        },
        xSlaRequirements: {
          maxLatencyMs: 30000,
          deliverableHashAlgorithm: 'SHA-256',
          pricingModel: {
            sku: 'API-GATEWAY-SUB',
            unitPriceUsd: 15.0,
            minQuantity: 1,
            maxQuantity: 1,
          },
        },
      },
    },
  },
};

/**
 * 4. Smart Contract Audit & Formal Verification OpenAPI 3.1 specification ($29.50 USD)
 */
export const SMART_AUDIT_OPENAPI_SPEC: OpenApiSpec = {
  openapi: '3.1.0',
  info: {
    title: 'Automated Smart Contract Audit & Formal Verification Engine',
    version: '2.4.0',
    description: 'Automated AST bytecode decompilation, symbolic execution, and mathematical invariance proofs for EVM smart contracts.',
    contact: {
      name: 'Audit Fiduciary Node',
      url: 'https://audit.fiduciary.agent.ai',
      email: 'security@fiduciary.agent.ai',
    },
  },
  servers: [
    {
      url: 'https://audit.fiduciary.agent.ai/v1',
      description: 'Formal Verification Engine Node',
    },
  ],
  paths: {
    '/audit/verify-contract': {
      post: {
        operationId: 'verifySmartContract',
        summary: 'Run automated formal verification and vulnerability scan',
        description: 'Performs reentrancy, integer overflow, and access control invariance proofs, emitting signed audit proof certificate.',
        parameters: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  contractType: { type: 'string', default: 'ERC20_PAYMENT_ESCROW' },
                  evmVersion: { type: 'string', default: 'cancun' },
                },
                required: ['contractType'],
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Formal verification completed with signed cryptographic audit manifest.',
          },
        },
        xSlaRequirements: {
          maxLatencyMs: 240000,
          deliverableHashAlgorithm: 'SHA-256',
          pricingModel: {
            sku: 'SMART-AUDIT-FORMAL',
            unitPriceUsd: 29.5,
            minQuantity: 1,
            maxQuantity: 1,
          },
        },
      },
    },
  },
};

/**
 * 5. Satellite Geospatial & Climate Embeddings OpenAPI 3.1 specification ($22.00 USD)
 */
export const GEO_SATELLITE_OPENAPI_SPEC: OpenApiSpec = {
  openapi: '3.1.0',
  info: {
    title: 'High-Resolution Satellite Geospatial & Climate Embeddings',
    version: '1.8.0',
    description: 'Multispectral imagery normalization, NDVI vegetation index calculation, and climate risk tensor generation for agricultural and hedge fund agents.',
    contact: {
      name: 'Geo Spatial Beta',
      url: 'https://geospatial.sentinel.agent.ai',
      email: 'geo@sentinel.agent.ai',
    },
  },
  servers: [
    {
      url: 'https://geospatial.sentinel.agent.ai/v1',
      description: 'Geospatial Imagery Processing Node',
    },
  ],
  paths: {
    '/geo/extract-embeddings': {
      post: {
        operationId: 'extractGeospatialEmbeddings',
        summary: 'Generate 5,000 km² multispectral terrain and drought risk embeddings',
        description: 'Delivers normalized 1024-dim climate risk vectors and signed GeoJSON boundary hashes.',
        parameters: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  coverageSqKm: { type: 'integer', default: 5000 },
                  resolutionMeters: { type: 'integer', default: 10 },
                },
                required: ['coverageSqKm'],
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Geospatial vector dataset generated and hashed.',
          },
        },
        xSlaRequirements: {
          maxLatencyMs: 150000,
          deliverableHashAlgorithm: 'SHA-256',
          pricingModel: {
            sku: 'GEO-SATELLITE-VECTORS',
            unitPriceUsd: 22.0,
            minQuantity: 1,
            maxQuantity: 1,
          },
        },
      },
    },
  },
};

/**
 * 6. Multilingual Whisper AI Speech-to-Text OpenAPI 3.1 specification ($18.50 USD)
 */
export const WHISPER_SPEECH_OPENAPI_SPEC: OpenApiSpec = {
  openapi: '3.1.0',
  info: {
    title: 'Multilingual Whisper AI Speech-to-Text Batch Transcription',
    version: '3.1.0',
    description: 'Enterprise parallelized Whisper Large-v3 diarization, word-level timestamping, and multi-speaker transcription pipeline.',
    contact: {
      name: 'Whisper Cluster Beta',
      url: 'https://transcribe.whisper-node.agent.ai',
      email: 'speech@whisper-node.agent.ai',
    },
  },
  servers: [
    {
      url: 'https://transcribe.whisper-node.agent.ai/v1',
      description: 'Whisper Clustered Node Endpoint',
    },
  ],
  paths: {
    '/speech/transcribe-batch': {
      post: {
        operationId: 'transcribeSpeechBatch',
        summary: 'Transcribe 500 audio minutes with speaker diarization and sentiment tags',
        description: 'Emits structured JSON transcripts with phonetic alignment and signed SHA-256 deliverable payload.',
        parameters: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  audioMinutes: { type: 'integer', default: 500 },
                  diarization: { type: 'boolean', default: true },
                },
                required: ['audioMinutes'],
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Batch audio transcription completed successfully.',
          },
        },
        xSlaRequirements: {
          maxLatencyMs: 100000,
          deliverableHashAlgorithm: 'SHA-256',
          pricingModel: {
            sku: 'WHISPER-SPEECH-BATCH',
            unitPriceUsd: 18.5,
            minQuantity: 1,
            maxQuantity: 1,
          },
        },
      },
    },
  },
};

/**
 * APIMatic Context Engine class
 * Ingests OpenAPI specs and provides runtime dynamic tools for Buyer Agent Alpha.
 */
export class ApimaticMcpService {
  private registry: Map<string, DiscoveredServiceContract> = new Map();

  constructor() {
    // Ingest the 6 enterprise seller service contracts on startup
    this.ingestOpenApiContract(FINANCIAL_SENTIMENT_OPENAPI_SPEC);
    this.ingestOpenApiContract(GPU_INFERENCE_OPENAPI_SPEC);
    this.ingestOpenApiContract(AP2_GATEWAY_OPENAPI_SPEC);
    this.ingestOpenApiContract(SMART_AUDIT_OPENAPI_SPEC);
    this.ingestOpenApiContract(GEO_SATELLITE_OPENAPI_SPEC);
    this.ingestOpenApiContract(WHISPER_SPEECH_OPENAPI_SPEC);
  }

  /**
   * Ingests an OpenAPI 3.1 specification, extracting typed endpoints, pricing models,
   * and synthesizing MCP function-calling tools.
   */
  public ingestOpenApiContract(spec: OpenApiSpec): DiscoveredServiceContract {
    const serviceId = spec.info.title.toLowerCase().replace(/[^a-z0-9]/g, '-');
    const baseUrl = spec.servers[0]?.url || 'https://api.seller.ai';

    let primarySku = 'FIN-SENTIMENT-Q4';
    let standardPrice = 25.0;
    let timeoutSeconds = 180;
    let verificationMethod = 'SHA256_HASH_VERIFICATION';
    let primaryEndpoint = '/datasets/financial-sentiment-q4';

    const tools: SynthesizedMcpTool[] = [];

    for (const [path, methods] of Object.entries(spec.paths)) {
      for (const [methodUpper, operationAny] of Object.entries(methods)) {
        const method = methodUpper.toUpperCase() as 'GET' | 'POST' | 'PUT' | 'DELETE';
        const operation = operationAny as OpenApiEndpoint;

        if (operation.xSlaRequirements?.pricingModel) {
          primarySku = operation.xSlaRequirements.pricingModel.sku;
          standardPrice = operation.xSlaRequirements.pricingModel.unitPriceUsd;
          primaryEndpoint = path;
          timeoutSeconds = Math.round(operation.xSlaRequirements.maxLatencyMs / 1000);
          verificationMethod = operation.xSlaRequirements.deliverableHashAlgorithm === 'SHA-256'
            ? 'SHA256_HASH_VERIFICATION'
            : 'SHA256_HASH_VERIFICATION';
        }

        const toolName = operation.operationId || `${method.toLowerCase()}_${path.replace(/[^a-zA-Z0-9]/g, '_')}`;
        
        // Dynamically build JSON schema for parameters
        const properties: Record<string, unknown> = {};
        const required: string[] = [];

        if (operation.parameters) {
          for (const param of operation.parameters) {
            properties[param.name] = param.schema || { type: 'string' };
            if (param.required) required.push(param.name);
          }
        }

        if (operation.requestBody?.content['application/json']?.schema) {
          const bodySchema = operation.requestBody.content['application/json'].schema;
          if (bodySchema.type === 'object' && bodySchema.properties) {
            Object.assign(properties, bodySchema.properties);
            if (Array.isArray(bodySchema.required)) {
              required.push(...(bodySchema.required as string[]));
            }
          }
        }

        tools.push({
          name: toolName,
          description: `[APIMatic Generated] ${operation.summary || operation.description}`,
          parameters: {
            type: 'object',
            properties,
            required,
          },
          slaMetadata: {
            sku: primarySku,
            unitPrice: standardPrice,
            timeoutSeconds,
            verificationMethod,
          },
          execute: async (args: Record<string, unknown>) => {
            return {
              endpoint: `${baseUrl}${path}`,
              method,
              receivedArguments: args,
              status: 'CONTRACT_VALIDATED',
              timestamp: new Date().toISOString(),
            };
          },
        });
      }
    }

    const contract: DiscoveredServiceContract = {
      serviceId,
      title: spec.info.title,
      version: spec.info.version,
      baseUrl,
      endpoint: primaryEndpoint,
      description: spec.info.description,
      sku: primarySku,
      standardPriceUsd: standardPrice,
      slaTimeoutSeconds: timeoutSeconds,
      verificationMethod,
      mcpTools: tools,
      openApiSpec: spec,
    };

    this.registry.set(serviceId, contract);
    return contract;
  }

  /**
   * Discovers service contracts matching criteria (used by Buyer Agent Alpha)
   */
  public discoverServices(query?: string): DiscoveredServiceContract[] {
    const contracts = Array.from(this.registry.values());
    if (!query) return contracts;
    const lower = query.toLowerCase();
    return contracts.filter(
      (c) =>
        c.title.toLowerCase().includes(lower) ||
        c.description.toLowerCase().includes(lower) ||
        c.sku.toLowerCase().includes(lower)
    );
  }

  /**
   * Retrieves a specific contract by ID or SKU
   */
  public getContractBySku(sku: string): DiscoveredServiceContract | undefined {
    return Array.from(this.registry.values()).find((c) => c.sku.toUpperCase() === sku.toUpperCase());
  }

  public getContract(serviceId: string): DiscoveredServiceContract | undefined {
    return this.registry.get(serviceId);
  }

  /**
   * Generates APIMatic Context Prompt text to ground the Buyer Agent's LLM reasoning
   */
  public generateAgentContextMarkdown(serviceIdOrSku: string): string {
    const contract = this.registry.get(serviceIdOrSku) || this.getContractBySku(serviceIdOrSku);
    if (!contract) return `Error: Service ${serviceIdOrSku} not found in APIMatic registry.`;

    return [
      `### APIMatic Context Plugin: ${contract.title} (v${contract.version})`,
      `**Base URL:** \`${contract.baseUrl}\``,
      `**Description:** ${contract.description}`,
      `**SLA Terms & Pricing:**`,
      `- Standard SKU: \`${contract.sku}\``,
      `- Base Price: \`$${contract.standardPriceUsd.toFixed(2)} USD\` (Settlement via PayPal Orders v2 / PYUSD)`,
      `- Delivery SLA: \`${contract.slaTimeoutSeconds} seconds\` timeout window`,
      `- Verification Oracle: \`${contract.verificationMethod}\``,
      `**Synthesized MCP Tool Surface:**`,
      ...contract.mcpTools.map(
        (t) => `- \`${t.name}(${Object.keys(t.parameters.properties).join(', ')})\`: ${t.description}`
      ),
    ].join('\n');
  }
}

export const apimaticService = new ApimaticMcpService();
