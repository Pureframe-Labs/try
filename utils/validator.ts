/**
 * ============================================================================
 * VALIDATION FUNCTIONS
 * ============================================================================
 * Input validation for API requests
 */

export interface LandRecordRequest {
  district: string
  taluka: string
  village: string
  gat_no: string
  sheet_no?: string
  whatsapp_phone: string
}

/**
 * Validate land record request data
 */
export function validateLandRecordRequest(data: any): {
  valid: boolean
  errors: string[]
} {
  const errors: string[] = []

  // Required fields
  if (!data.district || typeof data.district !== 'string' || data.district.trim().length === 0) {
    errors.push('District is required')
  }

  if (!data.taluka || typeof data.taluka !== 'string' || data.taluka.trim().length === 0) {
    errors.push('Taluka is required')
  }

  if (!data.village || typeof data.village !== 'string' || data.village.trim().length === 0) {
    errors.push('Village is required')
  }

  if (!data.gat_no || typeof data.gat_no !== 'string' || data.gat_no.trim().length === 0) {
    errors.push('Gat number is required')
  }

  if (!data.whatsapp_phone || typeof data.whatsapp_phone !== 'string') {
    errors.push('WhatsApp phone number is required')
  } else if (!/^\d{10,15}$/.test(data.whatsapp_phone.replace(/\D/g, ''))) {
    errors.push('Invalid phone number format')
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

/**
 * Validate payment verification data
 */
export function validatePaymentVerification(data: any): {
  valid: boolean
  errors: string[]
} {
  const errors: string[] = []

  if (!data.razorpay_order_id) {
    errors.push('Razorpay order ID is required')
  }

  if (!data.razorpay_payment_id) {
    errors.push('Razorpay payment ID is required')
  }

  if (!data.razorpay_signature) {
    errors.push('Razorpay signature is required')
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

/**
 * Validate module type
 */
export function isValidModuleType(moduleType: string): boolean {
  return ['7-12', '8a', 'property-card', 'ferfar'].includes(moduleType)
}