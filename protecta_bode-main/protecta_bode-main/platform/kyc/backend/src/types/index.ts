export interface User {
  id: string;
  email?: string;
  phone?: string;
  first_name?: string;
  last_name?: string;
  external_id?: string;
  status?: string;
  metadata?: any;
  created_at: Date;
  updated_at?: Date;
}

export interface VerificationRequest {
  id: string;
  user_id: string;
  developer_id: string;
  status: VerificationStatus;
  document_id?: string;
  selfie_id?: string;
  face_match_score?: number;
  liveness_score?: number;
  confidence_score?: number;
  // Extracted front-document identity fields, mirrored from the document for
  // verification-level reporting and compliance workflows.
  ocr_data?: OCRData;
  live_capture_completed?: boolean;
  manual_review_reason?: string;
  failure_reason?: string;
  external_verification_id?: string;
  // Manual-review attribution (set by the admin/reviewer/operator review action)
  reviewed_by?: string;
  reviewed_at?: string;
  // Enhanced verification fields
  back_of_id_uploaded?: boolean;
  cross_validation_score?: number;
  photo_consistency_score?: number;
  enhanced_verification_completed?: boolean;
  // Address verification fields
  address_verification_status?: 'pass' | 'review' | 'reject';
  address_data?: Record<string, any>;
  address_match_score?: number;
  // External correlation metadata (Odoo KYC/AML integration). Opaque strings.
  external_reference?: string | null;
  external_system?: string | null;
  subject_type?: string | null;
  odoo_partner_id?: string | null;
  odoo_guarantor_id?: string | null;
  odoo_lead_id?: string | null;
  created_at: Date;
  updated_at: Date;
}

export type VerificationStatus = 'pending' | 'processing' | 'verified' | 'failed' | 'manual_review';

export type VerificationSource = 'api' | 'vaas' | 'demo';

export interface Document {
  id: string;
  verification_request_id: string;
  file_path: string | null;
  file_name: string;
  file_size: number;
  mime_type: string;
  document_type: DocumentType;
  issuing_country?: string; // ISO 3166-1 alpha-2
  ocr_data?: OCRData;
  ocr_extracted?: boolean;
  quality_score?: number;
  quality_analysis?: any;
  authenticity_score?: number;
  // Back-of-ID fields
  is_back_of_id?: boolean;
  barcode_data?: any;
  cross_validation_results?: any;
  back_of_id_document_id?: string;
  created_at: Date;
}

export type DocumentType = 'passport' | 'drivers_license' | 'national_id' | 'other' | 'auto'
  | 'utility_bill' | 'bank_statement' | 'tax_document';

export interface Selfie {
  id: string;
  verification_request_id: string;
  file_path: string | null;
  file_name: string;
  file_size: number;
  liveness_score?: number;
  face_detected: boolean;
  created_at: Date;
}

export interface OCRData {
  name?: string;
  date_of_birth?: string;
  document_number?: string;
  expiration_date?: string;
  issuing_authority?: string;
  issuing_country?: string; // ISO 3166-1 alpha-2
  nationality?: string;
  address?: string;
  raw_text?: string;
  confidence_scores?: Record<string, number>;
  detected_document_type?: 'passport' | 'drivers_license' | 'national_id';
  classification_confidence?: number;
  // Additional fields for comprehensive document processing
  id_number?: string;
  expiry_date?: string;
  sex?: string;
  height?: string;
  eye_color?: string;
}

export interface APIKey {
  id: string;
  developer_id: string;
  key_hash: string;
  key_prefix: string;
  name: string;
  is_sandbox: boolean;
  is_active: boolean;
  last_used_at?: Date;
  created_at: Date;
  expires_at?: Date;
  // Service-key fields (cloud-only feature; null on developer ik_* keys)
  is_service?: boolean;
  service_product?: 'gatepass' | 'kabila-internal' | null;
  service_environment?: 'production' | 'staging' | 'development' | null;
  service_label?: string | null;
}

export interface Developer {
  id: string;
  email: string;
  name: string;
  company?: string;
  webhook_url?: string;
  sandbox_webhook_url?: string;
  is_verified: boolean;
  github_id?: number;
  avatar_url?: string;
  status?: 'active' | 'suspended';
  created_at: Date;
}

export interface Webhook {
  id: string;
  developer_id: string;
  url: string;
  is_sandbox: boolean;
  secret_token?: string;
  secret_key?: string;
  events?: string[];
  api_key_id?: string | null;
  is_active: boolean;
  created_at: Date;
}

export interface WebhookDelivery {
  id: string;
  webhook_id: string;
  verification_request_id: string;
  payload: WebhookPayload;
  status: 'pending' | 'delivered' | 'failed';
  response_status?: number;
  response_body?: string;
  attempts: number;
  next_retry_at?: Date;
  created_at: Date;
  delivered_at?: Date;
}

export interface WebhookPayload {
  event?: string;
  /** Stable event id - same for every webhook/delivery of one logical event. */
  event_id?: string;
  /** Delivery id - unique per webhook delivery row; Odoo may use as idempotency key. */
  delivery_id?: string;
  user_id: string;
  verification_id: string;
  status: VerificationStatus;
  timestamp: string;
  /** ISO-8601 creation timestamp (alias of timestamp; both are emitted). */
  created_at?: string;
  /** Internal Kabila user UUID (the users FK), when it differs from user_id. */
  internal_user_id?: string | null;
  /** Failure reason for failed events. */
  failure_reason?: string | null;
  /** Human review reason for manual_review events. */
  review_reason?: string | null;
  // External correlation metadata (echoed unchanged from initialization).
  external_system?: string | null;
  external_reference?: string | null;
  subject_type?: string | null;
  odoo_partner_id?: string | null;
  odoo_guarantor_id?: string | null;
  odoo_lead_id?: string | null;
  // Service-key context (Phase 2). Populated only when the verification was
  // driven by an isk_* service key. Receivers like GatePass use these to
  // route the callback to the right internal workspace/customer.
  is_service?: boolean;
  service_product?: string | null;
  service_environment?: string | null;
  /** Normalized verified identity data (completed verifications). */
  verification?: {
    full_name?: string | null;
    first_name?: string | null;
    middle_name?: string | null;
    last_name?: string | null;
    national_id?: string | null;
    national_id_type?: string | null;
    date_of_birth?: string | null;
    gender?: string | null;
    nationality?: string | null;
    country_of_birth?: string | null;
    phone?: string | null;
    email?: string | null;
    address?: {
      line_1?: string | null;
      line_2?: string | null;
      city?: string | null;
      district?: string | null;
      country?: string | null;
    };
  };
  /** Verified scores (0-1). */
  scores?: {
    document_score?: number | null;
    face_match_score?: number | null;
    liveness_score?: number | null;
    overall_score?: number | null;
  };
  /** Normalized AML/sanctions screening outcome. */
  aml_screening?: NormalizedAmlScreening | null;
  /** Secure cropped-face photo download info. */
  photos?: {
    face_crop_url?: string | null;
    face_crop_expires_at?: string | null;
    photo_sha256?: string | null;
    content_type?: string | null;
  };
  links?: {
    verification_url?: string | null;
  };
  /** Legacy nested payload - kept for backwards compatibility. */
  data?: {
    ocr_data?: OCRData;
    face_match_score?: number;
    liveness_score?: number;
    liveness_passed?: boolean;
    liveness_threshold?: number;
    liveness_provider?: string;
    liveness_mode?: string;
    liveness_signals?: Array<{ key: string; label: string; score: number; weight: number; note?: string }>;
    liveness_checks?: Record<string, { passed: boolean; weight: number; detail?: string }>;
    manual_review_reason?: string;
    failure_reason?: string;
    /**
     * Compact AML/sanctions/PEP screening outcome from the automatic
     * screening gate. Present on terminal events when screening ran.
     */
    aml_screening?: {
      risk_level: string;
      match_found: boolean;
      match_count: number;
      matches: Array<{ listed_name: string; list_source: string; score: number; match_type: string }>;
      lists_checked: string[];
      screened_name: string;
      screened_dob: string | null;
      screened_at: string;
    };
    /** SCR-… reference of the full screening record (fetch details via /api/v1/screen/:reference). */
    screening_reference?: string;
    /** Headline numbers from the full screening run (sanctions/PEP counts, review flag). */
    screening_summary?: {
      risk_level: string;
      match_found: boolean;
      requires_human_review: boolean;
      total_matches: number;
      sanctions_matches: number;
      pep_related_matches: number;
    };
  };
}

/** Normalized AML screening result Odoo can store directly. */
export interface NormalizedAmlScreening {
  /** clear | low_risk | medium_risk | high_risk | hit | manual_review | failed */
  status: string;
  risk_level: string;
  score: number;
  screening_reference: string | null;
  screened_at: string | null;
  datasets: string[];
  pep_match?: boolean;
  sanctions_match?: boolean;
  adverse_media_match?: boolean;
  matches: Array<{
    match_id: string;
    dataset: string;
    match_type: string;
    confidence: number;
    requires_manual_review: boolean;
  }>;
}

export interface RateLimitRecord {
  id: string;
  identifier: string;
  identifier_type: 'user' | 'developer' | 'ip';
  request_count: number;
  window_start: Date;
  blocked_until?: Date;
}

export interface AdminUser {
  id: string;
  email: string;
  role: 'admin' | 'reviewer';
  created_at: Date;
  updated_at?: Date;
}

// API Request/Response Types
export interface VerifyDocumentRequest {
  user_id: string;
  document_type: DocumentType;
  issuing_country?: string; // ISO 3166-1 alpha-2
  sandbox?: boolean;
}

export interface VerifyDocumentResponse {
  verification_id: string;
  status: VerificationStatus;
  message: string;
  upload_url?: string;
}

export interface VerifySelfieRequest {
  verification_id: string;
  sandbox?: boolean;
}

export interface VerifyStatusResponse {
  verification_id: string;
  user_id: string;
  status: VerificationStatus;
  created_at: string;
  updated_at: string;
  data?: {
    ocr_data?: OCRData;
    face_match_score?: number;
    manual_review_reason?: string;
    failure_reason?: string;
  };
}

export interface CreateAPIKeyRequest {
  name: string;
  is_sandbox?: boolean;
  expires_in_days?: number;
}

export interface CreateAPIKeyResponse {
  api_key: string;
  key_id: string;
  name: string;
  is_sandbox: boolean;
  expires_at?: string;
}

// External API Types
export interface PersonaVerificationResponse {
  id: string;
  status: 'pending' | 'passed' | 'failed' | 'requires_retry';
  decision?: string;
  reference_id?: string;
}

export interface OnfidoVerificationResponse {
  id: string;
  status: 'pending' | 'in_progress' | 'awaiting_approval' | 'complete';
  result?: 'clear' | 'consider';
  reference?: string;
}

// Configuration Types
export interface AppConfig {
  port: number;
  nodeEnv: string;
  corsOrigins: string[];
  railwayAllowedOrigins: string[];
  jwtSecret: string;
  apiKeySecret: string;
  serviceToken: string;
  encryptionKey: string;
  database: {
    url: string;
  };
  supabase: {
    url: string;
    anonKey: string;
    serviceRoleKey: string;
    storageBucket: string;
    vaasBucket: string;
    demoBucket: string;
  };
  storage: {
    provider: 'supabase' | 'local' | 's3';
    publicAssetBaseUrl: string;
    awsAccessKey?: string;
    awsSecretKey?: string;
    awsRegion?: string;
    awsS3Bucket?: string;
    encryption: boolean;
    encryptionKeyPrevious?: string;
  };
  ocr: {
    tesseractPath: string;
  };
  externalApis: {
    persona?: {
      apiKey: string;
      templateId: string;
    };
    onfido?: {
      apiKey: string;
      webhookToken: string;
    };
  };
  rateLimiting: {
    enabled: boolean;
    windowMs: number;
    maxRequestsPerUser: number;
    maxRequestsPerDev: number;
  };
  webhooks: {
    retryAttempts: number;
    timeoutMs: number;
  };
  compliance: {
    dataRetentionDays: number;
    gdprCompliance: boolean;
  };
  sandbox: {
    enabled: boolean;
    mockVerification: boolean;
    mockDelayMs: number;
    retentionHours: number;
  };
  capabilities: {
    voiceAuth: boolean;
  };
  providers: {
    ocr: 'tesseract' | 'openai' | 'azure' | 'aws-textract' | 'auto';
    face: 'tensorflow' | 'aws-rekognition' | 'custom';
    liveness: 'enhanced-heuristic' | 'custom';
    customOcrEndpoint?: string;
    customFaceEndpoint?: string;
  };
email: {
    fromAddress: string;
    smtpHost: string;
    smtpPort: number;
    smtpSecure: boolean;
    smtpUser: string;
    smtpPassword: string;
  };
  github: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
  };
  whatsapp: {
    serviceUrl: string;
    apiKey: string;
    instance: string;
  };
  evolution: {
    baseUrl: string;
    apiKey: string;
    instance: string;
  };
}

// Error Types
export interface APIError {
  code: string;
  message: string;
  details?: Record<string, any>;
}

export interface ValidationError extends APIError {
  field: string;
  value: any;
}

// Middleware Types
export interface AuthenticatedRequest extends Express.Request {
  developer?: Developer;
  apiKey?: APIKey;
  user?: User;
}

export interface Reviewer {
  id: string;
  developer_id: string;
  email: string;
  name?: string;
  role: 'reviewer' | 'admin';
  status: 'invited' | 'active' | 'revoked';
  invited_at: string;
  last_login_at?: string;
}

declare global {
  namespace Express {
    interface Request {
      developer?: Developer;
      apiKey?: APIKey;
      user?: User;
      reviewer?: Reviewer;
      sessionVerificationId?: string;
      // True when authenticated via a service key (isk_*). Convenience signal
      // for middleware to short-circuit rate limits, quotas, and plan checks.
      // Equivalent to `req.apiKey?.is_service === true`.
      isService?: boolean;
    }
  }
}