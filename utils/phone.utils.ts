/**
 * Extract real phone number from WhatsApp IDs
 * @param whatsappId WhatsApp ID (e.g., "919926876234@c.us", "195412757610511@lid", etc.)
 * @returns Real phone number or null
 */
export function extractRealPhoneNumber(whatsappId: string): string | null {
    if (!whatsappId) return null
    
    // Remove any suffix (@c.us, @lid, @g.us, etc.)
    let phone = whatsappId.split('@')[0]
    
    // Clean: remove non-digits
    phone = phone.replace(/\D/g, '')
    
    // Validate Indian phone number (10 digits after 91)
    if (phone.startsWith('91') && phone.length === 12) {
        return phone // 91XXXXXXXXXX
    }
    
    // If it's the @lid internal ID (107593343180511), it's not a real phone
    if (whatsappId.includes('@lid')) {
        console.log(`❌ @lid ID cannot be converted to real phone: ${whatsappId}`)
        return null
    }
    
    // Try other formats
    if (phone.length >= 10) {
        // Assume it's a phone without country code
        if (phone.length === 10) {
            return `91${phone}` // Add India code
        }
        return phone
    }
    
    console.log(`❌ Invalid phone format: ${whatsappId}`)
    return null
}

/**
 * Convert to WhatsApp @c.us format
 */
export function toWhatsAppFormat(phone: string): string {
    if (!phone) return ''
    
    // Clean: remove non-digits
    let clean = phone.replace(/\D/g, '')
    
    // Add country code if missing
    if (clean.length === 10) {
        clean = `91${clean}`
    }
    
    return `${clean}@c.us`
}