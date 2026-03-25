/**
 * ============================================================================
 * WELCOME MESSAGE TEMPLATE
 * ============================================================================
 */

export function welcomeMessage() {
  return {
    type: 'interactive',
    interactive: {
      type: 'button',
      header: {
        type: 'text',
        text: '🏛️ Welcome to Land Records Bot',
      },
      body: {
        text: `Hello! I'm here to help you with land record services.

Please select a service from the options below:

📋 *Available Services:*
- 7/12 Form - ₹20
- 8A Form - ₹20  
- Property Card - ₹25
- Ferfar - ₹30

All services include WhatsApp form filling and secure payment.`,
      },
      footer: {
        text: 'Select a service to continue',
      },
      action: {
        buttons: [
          {
            type: 'reply',
            reply: {
              id: '712_service',
              title: '📄 7/12 Form',
            },
          },
          {
            type: 'reply',
            reply: {
              id: '8a_service',
              title: '📝 8A Form',
            },
          },
          {
            type: 'reply',
            reply: {
              id: 'ferfar_service',
              title: '🔄 Ferfar',
            },
          },
        ],
      },
    },
  }
}

export function propertyCardButton() {
  return {
    type: 'interactive',
    interactive: {
      type: 'button',
      body: {
        text: 'Would you like to request a Property Card?',
      },
      action: {
        buttons: [
          {
            type: 'reply',
            reply: {
              id: 'property_card_service',
              title: '🏠 Property Card',
            },
          },
        ],
      },
    },
  }
}