/**
 * ============================================================================
 * PAYMENT CONFIGURATION
 * ============================================================================
 * 
 * Purpose:
 * Central configuration for payment-related settings.
 * Defines the currency and pricing model for different document services.
 */

export const paymentConfig = {
  /**
   * Currency code for transactions (e.g., 'INR', 'USD').
   */
  currency: 'INR',

  /**
   * Pricing mapping for each document type.
   * Prices are in the smallest currency unit if handled by Gateway (usually),
   * but here they appear to be in main units (Rupees).
   * 
   * - 7-12: ₹20
   * - 8a: ₹20
   * - property-card: ₹25
   * - ferfar: ₹30
   */
  formPrices: {
    '7-12': 20,
    '8a': 20,
    'property-card': 25,
    'ferfar': 30
  }
}