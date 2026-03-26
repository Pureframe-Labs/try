/**
 * ============================================================================
 * SESSION MANAGER SERVICE
 * ============================================================================
 * 
 * Purpose:
 * Core state machine for the WhatsApp chatbot.
 * Manages user sessions, navigation, form data collection, and context switching.
 * 
 * Flow:
 * 1. `handleMessage` receives text from `WhatsAppClientService`.
 * 2. Checks current session state (Service Selection -> Form Steps -> Confirmation).
 * 3. Updates session state in DB (`sessions` table).
 * 4. Sends appropriate response/prompt to user.
 */

import { sql } from '../config/database.config'
import { whatsappService } from './whatsapp.service'
import { paymentService } from './payment.service'
import { paymentConfig } from '../config/payment.config'
import { logger } from '../utils/logger'
import fs from 'fs'
import path from 'path'
import * as amqp from 'amqplib'
import menuData from '../data/output.json'
import { formatAsTable } from '../utils/helpers'

// Interfaces for Menu Data Structure (District/Taluka/Village)
interface MenuItem {
  id: string
  display: string
  backend_value: string
}

interface MenuData {
  district_menu: MenuItem[]
  taluka_menu: Record<string, MenuItem[]>
  village_menu: Record<string, MenuItem[]>
}

const typedMenuData = menuData as any; // Adapting to output.json structure dynamically

// Session State Interface
interface Session {
  phoneNumber: string
  currentService?: '7-12' | '8a' | 'property-card' | 'ferfar'
  currentStep?: string // e.g., 'district', 'taluka', 'awaiting_payment'
  formData: Record<string, any> // Variable storage for user inputs
  orderId?: string
  requestId?: number
  menuOffset?: number // For paginated list messages
  createdAt: Date
  updatedAt: Date
}

interface ServiceConfig {
  steps: string[]
  price: number
  requiredFields: string[]
  displayName: string
  usesMenuData: boolean // Whether this module uses the district/taluka/village menu
  fieldMappings?: Record<string, string> // Map frontend fields to DB fields
}

class SessionManagerService {
  private serviceConfigs: Record<string, ServiceConfig> = {
    '7-12': {
      steps: ['district', 'taluka', 'village', 'gat_no'],
      price: paymentConfig.formPrices['7-12'],
      requiredFields: ['district', 'taluka', 'village', 'gat_no'],
      displayName: '7/12 Form (सातबारा)',
      usesMenuData: true,
      fieldMappings: {
        'district': 'district',
        'taluka': 'taluka',
        'village': 'village',
        'gat_no': 'gat_no'
      }
    },
    '8a': {
      steps: ['district', 'taluka', 'village', 'gat_no'],
      price: paymentConfig.formPrices['8a'],
      requiredFields: ['district', 'taluka', 'village', 'gat_no'],
      displayName: '8A Form',
      usesMenuData: true,
      fieldMappings: {
        'district': 'district',
        'taluka': 'taluka',
        'village': 'village',
        'gat_no': 'gat_no'
      }
    },
    'property-card': {
      steps: ['region', 'district', 'office', 'village', 'cts_no'],
      price: paymentConfig.formPrices['property-card'],
      requiredFields: ['region', 'district', 'office', 'village', 'cts_no'],
      displayName: 'Property Card (मालमत्ता कार्ड)',
      usesMenuData: false, // Property Card doesn't use the same menu system
      fieldMappings: {
        'region': 'region',
        'district': 'district',
        'office': 'office',
        'village': 'village',
        'cts_no': 'gat_no' // Map to gat_no in DB
      }
    },
    'ferfar': {
      steps: ['district', 'taluka', 'village', 'mutation_no'],
      price: paymentConfig.formPrices.ferfar,
      requiredFields: ['district', 'taluka', 'village', 'mutation_no'],
      displayName: 'Ferfar (फेरफार)',
      usesMenuData: true,
      fieldMappings: {
        'district': 'district',
        'taluka': 'taluka',
        'village': 'village',
        'mutation_no': 'gat_no' // Map to gat_no in DB
      }
    }
  }

  private mqConnection: any = null;
  private mqChannel: any = null;

  private async initQueue() {
    if (this.mqChannel) return;
    try {
      const mqUrl = process.env.RABBITMQ_URL || 'amqp://localhost';
      this.mqConnection = await amqp.connect(mqUrl);
      this.mqChannel = await this.mqConnection.createChannel();
      await this.mqChannel.assertQueue('extraction_queue', { durable: true });
    } catch (err: any) {
      logger.error('❌ RabbitMQ Init Failed in SessionManager:', err.message);
    }
  }

  private async queueExtraction(data: any) {
    await this.initQueue();
    if (this.mqChannel) {
      this.mqChannel.sendToQueue(
        'extraction_queue',
        Buffer.from(JSON.stringify(data)),
        { persistent: true }
      );
      logger.info(`📤 Job queued for extraction: ${data.phoneNumber}`);
    } else {
      throw new Error('RabbitMQ channel not available');
    }
  }

  // ==========================================
  // DB SESSION MANAGEMENT
  // ==========================================
  async getSession(phoneNumber: string): Promise<Session> {
    try {
      const result = await sql`
        INSERT INTO sessions (phone_number, data, started_at, updated_at)
        VALUES (${phoneNumber}, ${JSON.stringify({})}, NOW(), NOW())
        ON CONFLICT (phone_number) DO UPDATE SET updated_at = NOW()
        RETURNING *
      `

      if (result && result.length > 0) {
        const session = result[0]
        let formData = {}
        if (session.data) {
          try {
            formData = typeof session.data === 'string' ? JSON.parse(session.data) : session.data
          } catch (e) {
            formData = {}
          }
        }

        return {
          phoneNumber: session.phone_number,
          currentService: session.current_service as Session['currentService'],
          currentStep: session.step,
          formData: formData,
          orderId: session.order_id,
          requestId: session.request_id,
          menuOffset: session.menu_offset || 0,
          createdAt: session.started_at,
          updatedAt: session.updated_at || session.started_at
        }
      }
      return { phoneNumber, formData: {}, createdAt: new Date(), updatedAt: new Date() }
    } catch (error: any) {
      return { phoneNumber, formData: {}, createdAt: new Date(), updatedAt: new Date() }
    }
  }

  async updateSession(phoneNumber: string, updates: Partial<Session>): Promise<void> {
    try {
      const current = await this.getSession(phoneNumber)
      const currentService = updates.currentService !== undefined ? updates.currentService : current.currentService
      const currentStep = updates.currentStep !== undefined ? updates.currentStep : current.currentStep

      await sql`
        UPDATE sessions 
        SET 
          current_service = ${currentService || null},
          step = ${currentStep || null},
          data = ${JSON.stringify(updates.formData || current.formData || {})}::jsonb,
          order_id = ${(updates.orderId !== undefined ? updates.orderId : current.orderId) || null},
          request_id = ${(updates.requestId !== undefined ? updates.requestId : current.requestId) || null},
          menu_offset = ${(updates.menuOffset !== undefined ? updates.menuOffset : current.menuOffset) || 0},
          updated_at = NOW()
        WHERE phone_number = ${phoneNumber}
      `
      logger.debug(`💾 Session Updated: ${phoneNumber} | Step: ${currentStep} | Offset: ${updates.menuOffset || current.menuOffset}`)
    } catch (error: any) {
      logger.error('❌ Error updating session:', error.message)
    }
  }

  async clearSession(phoneNumber: string): Promise<void> {
    try {
      await sql`DELETE FROM sessions WHERE phone_number = ${phoneNumber}`
      logger.info(`🗑️ Session Cleared: ${phoneNumber}`)
    } catch (error: any) {
      logger.error('Error clearing session:', error.message)
    }
  }

  /**
   * Cancel a session and notify worker
   */
  async cancelSession(phoneNumber: string): Promise<void> {
    try {
      const session = await this.getSession(phoneNumber);

      if (session.currentService && session.requestId) {
        const table = this.getTableName(session.currentService);
        await sql`UPDATE ${sql(table)} SET status = 'cancelled' WHERE id = ${session.requestId}`;
        logger.info(`🚫 Request ${session.requestId} marked as cancelled in DB`);
      }

      await this.clearSession(phoneNumber);

      await whatsappService.sendMessage(
        phoneNumber,
        "❌ *Session Cancelled.*\n\nYour current request has been stopped. You can type 'Hi' anytime to start a new search."
      );

    } catch (error: any) {
      logger.error('❌ Error cancelling session:', error.message);
      await whatsappService.sendMessage(phoneNumber, "An error occurred while cancelling your session.");
    }
  }

  /**
   * Get table name for a service
   */
  private getTableName(service: string): string {
    return `requests_${service.replace('-', '_')}`;
  }

  // ==========================================
  // MAIN MESSAGE HANDLER
  // ==========================================

  /**
   * Main entry point for processing incoming user messages.
   * Routes the message based on the user's current session state.
   * 
   * Handling Logic:
   * 1. Global Commands (Cancel, Hi/Menu).
   * 2. Step-specific handlers (Confirmation, Form Filling).
   * 3. Service Selection (Initial State).
   */
  async handleMessage(phoneNumber: string, message: string, session: Session, media?: any): Promise<void> {
    const text = message.trim();
    const lowerText = text.toLowerCase();
    
    logger.info(`📥 Message: ${phoneNumber} | Text: "${text}" | Service: ${session.currentService} | Step: ${session.currentStep} | Offset: ${session.menuOffset}`);

    // Handle PDF documents
    if (media && media.type === 'document') {
      await this.handlePdfMessage(phoneNumber, media, session);
      return;
    }

    // Check for cancel commands
    if (['cancel', 'stop', 'exit'].includes(lowerText)) {
      await this.cancelSession(phoneNumber);
      return;
    }

    // Check for start commands
    if (['hi', 'hello', 'start', 'menu'].includes(lowerText)) {
      await this.clearSession(phoneNumber);
      await this.sendWelcomeMessage(phoneNumber);
      return;
    }

    // Handle confirmation step
    if (session.currentStep === 'awaiting_confirmation') {
      await this.handleConfirmation(phoneNumber, text, session);
      return;
    }

    // Handle extraction confirmation step
    if (session.currentStep === 'awaiting_extraction_confirmation') {
      await this.handleExtractionConfirmation(phoneNumber, text, session);
      return;
    }

    // Handle form steps
    if (session.currentService) {
      await this.handleFormStep(phoneNumber, text, session);
      return;
    }

    // Handle service selection
    await this.handleServiceSelection(phoneNumber, lowerText, session);
  }

  /**
   * Send welcome message
   */
  private async sendWelcomeMessage(phoneNumber: string): Promise<void> {
    await whatsappService.sendListMessage(
      phoneNumber,
      "🏛️ *Welcome to Land Records Bot*\n\nPlease select a service to continue:",
      "Select Service",
      [
        {
          title: "Land Records",
          rows: [
            { id: "svc_7-12", title: "7/12 Form" },
            { id: "svc_8a", title: "8A Form" },
            { id: "svc_ferfar", title: "Ferfar" },
            { id: "svc_property-card", title: "Property Card" }
          ]
        }
      ]
    );
  }

  /**
   * Handle service selection
   */
  private async handleServiceSelection(phoneNumber: string, text: string, session: Session): Promise<void> {
    let selectedService: Session['currentService'] | null = null;

    if (text.startsWith('svc_')) {
      selectedService = text.replace('svc_', '') as any;
    } else if (text.includes('1') || text.includes('7/12')) {
      selectedService = '7-12';
    } else if (text.includes('2') || text.includes('8a')) {
      selectedService = '8a';
    } else if (text.includes('3') || text.includes('property')) {
      selectedService = 'property-card';
    } else if (text.includes('4') || text.includes('ferfar')) {
      selectedService = 'ferfar';
    }

    if (selectedService) {
      const config = this.serviceConfigs[selectedService];
      const firstStep = config.steps[0];
      const newFormData = {};

      await this.updateSession(phoneNumber, {
        currentService: selectedService,
        currentStep: firstStep,
        formData: newFormData
      });

      const updatedSession = { ...session, currentService: selectedService, currentStep: firstStep, formData: newFormData };
      await this.sendStepMessage(phoneNumber, selectedService, firstStep, updatedSession);
    } else {
      await whatsappService.sendMessage(phoneNumber,
        "❌ Invalid selection. Please type:\n1 for 7/12\n2 for 8A\n3 for Property Card\n4 for Ferfar"
      );
    }
  }

  /**
   * Delegates specific form step handling based on the active service configuration.
   * Determines if the step requires menu validation (dropdowns) or custom input.
   */
  private async handleFormStep(phoneNumber: string, text: string, session: Session): Promise<void> {
    const config = this.serviceConfigs[session.currentService!];
    const currentStep = session.currentStep!;

    // Districts, Talukas, and Villages use the menu system
    const isMenuStep = ['district', 'taluka', 'village'].includes(currentStep);

    if (config.usesMenuData && isMenuStep) {
      await this.handleMenuBasedStep(phoneNumber, text, session, config);
    } else {
      // Manual entry steps like gat_no, survey_no, cts_no
      await this.handleCustomStep(phoneNumber, text, session, config);
    }
  }
  /**
   * Handle steps that use district/taluka/village menus (7-12, 8A, Ferfar)
   */
  private async handleMenuBasedStep(phoneNumber: string, text: string, session: Session, config: ServiceConfig): Promise<void> {
    const currentStep = session.currentStep!;
    let valueToStore = text.trim();

    // 1. Resolve Data Source for validation/search
    let options: any[] = [];
    if (currentStep === 'district') {
      options = typedMenuData.districts || [];
    } else if (currentStep === 'taluka') {
      const district = (typedMenuData.districts || []).find((d: any) => d.name === session.formData.district);
      options = district?.talukas || [];
    } else if (currentStep === 'village') {
      const district = (typedMenuData.districts || []).find((d: any) => d.name === session.formData.district);
      const taluka = (district?.talukas || []).find((t: any) => t.name === session.formData.taluka);
      options = taluka?.villages || [];
    }

    // 2. Try numeric selection first
    const num = parseInt(valueToStore, 10);
    if (!isNaN(num)) {
      if (num >= 1 && num <= options.length) {
        const selected = options[num - 1];
        valueToStore = typeof selected === 'string' ? selected : selected.name;
      } else {
        await whatsappService.sendMessage(phoneNumber, `❌ Invalid number. Please enter a number between 1 and ${options.length}.`);
        await this.sendStepMessage(phoneNumber, session.currentService!, currentStep, session);
        return;
      }
    }

    // 3. Resolve Data Source for validation/search if not numeric
    const cleanValue = valueToStore.replace(/^(dist_|tal_|vil_)/, '');

    // 4. Perform Search if text doesn't match an ID exactly
    const match = options.find((opt: any) => {
      const name = typeof opt === 'string' ? opt : opt.name;
      return name === valueToStore || name === cleanValue;
    });

    if (!match) {
      // If no exact match, try fuzzy search / filter
      const filtered = options.filter((opt: any) => {
        const name = typeof opt === 'string' ? opt : opt.name;
        return name.toLowerCase().includes(valueToStore.toLowerCase());
      });

      if (filtered.length === 0) {
        await whatsappService.sendMessage(phoneNumber, `❌ Could not find "${valueToStore}". Please try a different spelling or select from the list.`);
        await this.sendStepMessage(phoneNumber, session.currentService!, currentStep, session);
        return;
      }

      if (filtered.length === 1) {
        valueToStore = typeof filtered[0] === 'string' ? filtered[0] : filtered[0].name;
      } else {
        // Show filtered list
        const items = filtered.map((opt: any) => {
          const name = typeof opt === 'string' ? opt : opt.name;
          const prefixMap: any = { district: 'dist_', taluka: 'tal_', village: 'vil_' };
          return { id: `${prefixMap[currentStep]}${name}`, title: name };
        });
        await this.sendPaginatedList(phoneNumber, "Search Results", `🔍 Found ${filtered.length} matches for "${valueToStore}":`, items, 0);
        return;
      }
    } else {
      valueToStore = typeof match === 'string' ? match : match.name;
    }

    // 5. Success - Store value and proceed
    const updatedFormData = { ...session.formData, [currentStep]: valueToStore };
    
    // Reset offset for next step
    await this.updateSession(phoneNumber, { menuOffset: 0 });

    if (config.requiredFields.every(f => updatedFormData[f])) {
      const dbFormData = this.mapFormDataToDb(session.currentService!, updatedFormData);
      await this.initiateVerification(phoneNumber, session.currentService!, dbFormData);
    } else {
      const nextStep = config.steps[config.steps.indexOf(currentStep) + 1];
      await this.updateSession(phoneNumber, { currentStep: nextStep, formData: updatedFormData });
      await this.sendStepMessage(phoneNumber, session.currentService!, nextStep, { ...session, currentStep: nextStep, formData: updatedFormData, menuOffset: 0 });
    }
  }

  /**
   * Handle custom steps for Property Card
   */
  private async handleCustomStep(phoneNumber: string, text: string, session: Session, config: ServiceConfig): Promise<void> {
    const currentStep = session.currentStep!;
    const valueToStore = text.trim();

    // For Property Card, we don't validate against menus - just store the input
    const updatedFormData = { ...session.formData, [currentStep]: valueToStore };

    // Check if all required fields are filled
    const allRequiredFilled = config.requiredFields.every(f =>
      updatedFormData[f] && updatedFormData[f].toString().length > 0
    );

    if (allRequiredFilled) {
      // Map form data to database fields
      const dbFormData = this.mapFormDataToDb(session.currentService!, updatedFormData);
      await this.initiateVerification(phoneNumber, session.currentService!, dbFormData);
    } else {
      // Move to next step
      const currentStepIndex = config.steps.indexOf(currentStep);
      const nextStep = config.steps[currentStepIndex + 1];
      if (nextStep) {
        await this.updateSession(phoneNumber, { currentStep: nextStep, formData: updatedFormData });
        const updatedSession = { ...session, currentStep: nextStep, formData: updatedFormData };
        await this.sendStepMessage(phoneNumber, session.currentService!, nextStep, updatedSession);
      }
    }
  }

  /**
   * Map frontend form data to database field names
   */
  private mapFormDataToDb(service: string, formData: Record<string, any>): Record<string, any> {
    const config = this.serviceConfigs[service];
    const dbData: Record<string, any> = {};

    for (const [frontendField, value] of Object.entries(formData)) {
      const dbField = config.fieldMappings?.[frontendField] || frontendField;
      dbData[dbField] = value;
    }

    return dbData;
  }

  /**
   * Handle confirmation step (Yes/No after verification)
   */
  private async handleConfirmation(phoneNumber: string, text: string, session: Session): Promise<void> {
    const config = this.serviceConfigs[session.currentService!];

    const normalizedText = text.toLowerCase();
    if (normalizedText === 'yes' || normalizedText === 'y' || normalizedText === 'confirm_yes') {
      // Create Razorpay Order
      const order = await paymentService.createOrder(session.currentService!, session.requestId!, phoneNumber);

      await this.updateSession(phoneNumber, {
        currentStep: 'awaiting_payment',
        orderId: order.id
      });

      await whatsappService.sendPaymentLink(phoneNumber, order.id, config.price, config.displayName);
      await whatsappService.sendMessage(phoneNumber,
        "_The worker is processing your request. Once you pay, the PDF will be sent automatically._"
      );
    }
    else if (normalizedText === 'no' || normalizedText === 'n' || normalizedText === 'confirm_no') {
      const table = this.getTableName(session.currentService!);
      const id = session.requestId ?? null;
      if (id) {
        await sql`UPDATE ${sql(table)} SET status = 'cancelled' WHERE id = ${id}`;
      }

      await whatsappService.sendMessage(phoneNumber,
        "❌ Request cancelled. You can type 'Hi' to start again."
      );
      await this.clearSession(phoneNumber);
    }
    else {
      const buttons = [
        { id: "confirm_yes", title: "Yes, Proceed" },
        { id: "confirm_no", title: "No, Cancel" }
      ];
      await whatsappService.sendReplyButtons(phoneNumber, "Would you like to proceed with the payment?", buttons);
    }
  }

  /**
   * Handle extraction confirmation (Yes/No after PDF extraction)
   */
  private async handleExtractionConfirmation(phoneNumber: string, text: string, session: Session): Promise<void> {
    const normalizedText = text.toLowerCase();
    if (['yes', 'y', 'confirm', 'ext_yes'].includes(normalizedText)) {
      const dbFormData = this.mapFormDataToDb('7-12', session.formData);
      await whatsappService.sendMessage(phoneNumber, "✅ Details confirmed. Proceeding with verification...");
      await this.initiateVerification(phoneNumber, '7-12', dbFormData);

    } else if (['no', 'n', 'ext_no'].includes(normalizedText)) {
      await whatsappService.sendMessage(phoneNumber, "❌ Okay, let's enter the details manually.");
      await this.handleServiceSelection(phoneNumber, "svc_7-12", session);
    } else {
      const buttons = [
        { id: "ext_yes", title: "Yes, Correct" },
        { id: "ext_no", title: "No, Edit" }
      ];
      await whatsappService.sendReplyButtons(phoneNumber, "Is the extracted information correct?", buttons);
    }
  }

  /**
   * Handle incoming PDF message
   */
  async handlePdfMessage(phoneNumber: string, media: any, session: Session): Promise<void> {
    await whatsappService.sendMessage(phoneNumber, "📄 PDF received. Analyzing document...");

    const tempDir = path.join(process.cwd(), 'uploads', 'pdf');
    const fileName = `${phoneNumber}_${media.id}.pdf`;
    const savePath = path.join(tempDir, fileName);

    const success = await whatsappService.downloadMedia(media.id, savePath);
    if (!success) {
      await whatsappService.sendMessage(phoneNumber, "❌ Failed to download PDF. Please try again.");
      return;
    }

    try {
      await this.queueExtraction({
        phoneNumber,
        pdfPath: savePath,
        mediaId: media.id,
        timestamp: new Date().toISOString()
      });
    } catch (err) {
      logger.error('❌ Failed to queue extraction:', err);
      await whatsappService.sendMessage(phoneNumber, "❌ Error processing request. Please try again later.");
    }
  }

  /**
   * Called by backend endpoint when worker finishes extraction
   */
  async onExtractionComplete(phoneNumber: string, result: any): Promise<void> {
    const session = await this.getSession(phoneNumber);
    
    if (!result.success && result.error) {
       logger.error(`Extraction tool error: ${result.error}`);
       await whatsappService.sendMessage(phoneNumber, "❌ Could not extract data from the PDF.");
       return;
    }

    // Store extracted data in session
    await this.updateSession(phoneNumber, {
       currentService: '7-12',
       currentStep: 'awaiting_extraction_confirmation',
       formData: {
         ...session.formData,
         pdf_path: result.pdfPath,
         district: result.District || '',
         taluka: result.Taluka || '',
         village: result.Village || '',
         gat_no: result.GatNumber || ''
       }
    });

    // Send Confirmation Message
    const msg = `✅ *Extracted Data:*\n\n` +
      `📍 District: ${result.District || 'Not found'}\n` +
      `🏘️ Taluka: ${result.Taluka || 'Not found'}\n` +
      `🏡 Village: ${result.Village || 'Not found'}\n` +
      `🔢 Gat No: ${result.GatNumber || 'Not found'}\n\n` +
      `Is this correct?`;

    const buttons = [
      { id: "ext_yes", title: "Yes, Correct" },
      { id: "ext_no", title: "No, Edit Manually" }
    ];
    await whatsappService.sendReplyButtons(phoneNumber, msg, buttons);
  }

  private async sendStepMessage(phoneNumber: string, service: string, step: string, session: Session): Promise<void> {
    const config = this.serviceConfigs[service];
    let message = '';
    const offset = session.menuOffset || 0;

    if (service === 'property-card') {
      // (Keep existing property-card logic...)
      switch (step) {
        case 'region':
          message = '🌍 *Step 1:* Please enter your *Region*.';
          break;
        case 'district':
          message = '🏛️ *Step 2:* Please enter the *District* name.';
          break;
        case 'office':
          message = '🏢 *Step 3:* Please enter the *Office/Tehsil* name.';
          break;
        case 'village':
          message = '🏡 *Step 4:* Please enter the *Village* name.';
          break;
        case 'cts_no':
          message = '🔢 *Step 5:* Please enter the *CTS Number / Survey Number*.\n_(Example: 1234 or 45/2)_';
          break;
      }
    } else if (config?.usesMenuData) {
      switch (step) {
        case 'district': {
          const districts = typedMenuData.districts || [];
          const names = districts.map((d: any) => d.name);
          const list = formatAsTable(names);
          await whatsappService.sendMessage(phoneNumber, `📍 *Step 1 - District:*\n\n${list}\n\n_Reply with the number_`);
          return;
        }
        case 'taluka': {
          const districtName = session.formData.district;
          const district = (typedMenuData.districts || []).find((d: any) => d.name === districtName);
          const talukas = district?.talukas || [];
          const names = talukas.map((t: any) => t.name);
          const list = formatAsTable(names);
          await whatsappService.sendMessage(phoneNumber, `🏘️ *Step 2 - Taluka* (${districtName})*:*\n\n${list}\n\n_Reply with the number_`);
          return;
        }
        case 'village': {
          const districtName = session.formData.district;
          const talukaName = session.formData.taluka;
          const district = (typedMenuData.districts || []).find((d: any) => d.name === districtName);
          const taluka = (district?.talukas || []).find((t: any) => t.name === talukaName);
          const villages = taluka?.villages || [];
          const list = formatAsTable(villages);
          await whatsappService.sendMessage(phoneNumber, `🏡 *Step 3 - Village* (${talukaName})*:*\n\n${list}\n\n_Reply with the number_`);
          return;
        }
        case 'gat_no':
          message = '🔢 *Step 4:* Enter the *Gat / Survey Number*.\n_(Example: 101 or 45/2)_';
          break;
        case 'mutation_no':
          message = '🔄 *Step 5:* Enter the *Mutation (Ferfar) Number*.';
          break;
      }
    }

    if (message) {
      await whatsappService.sendMessage(phoneNumber, message);
    }
  }

  private async sendPaginatedList(phoneNumber: string, buttonText: string, bodyText: string, allItems: any[], offset: number) {
    const limit = 8;
    const paginatedItems = allItems.slice(offset, offset + limit);
    const hasMore = allItems.length > offset + limit;

    const rows = paginatedItems.map(item => ({
      id: item.id,
      title: item.title.substring(0, 24)
    }));

    if (hasMore) {
      rows.push({
        id: "next_page",
        title: "➡️ View More..."
      });
    }

    if (offset > 0) {
      rows.unshift({
        id: "prev_page",
        title: "⬅️ Back"
      });
    }

    await whatsappService.sendListMessage(
      phoneNumber,
      bodyText,
      buttonText,
      [{ title: "Options", rows }]
    );
  }


  // ==========================================
  // VERIFICATION & WORKER QUEUING
  // ==========================================

  /**
   * Initiatives the background verification process.
   * 1. Creates a Request record in the specific service table.
   * 2. Queues a task in RabbitMQ for the worker.
   * 3. Starts polling the database for status updates.
   */
  private async initiateVerification(phoneNumber: string, service: string, formData: Record<string, any>): Promise<void> {
    try {
      const request = await this.createServiceRequest(service, phoneNumber, formData);
      await this.updateSession(phoneNumber, { requestId: request.id, formData });

      await whatsappService.sendMessage(phoneNumber,
        "🔍 *Verifying Record...* Please wait while we check the official portal."
      );

      await this.queueTask(service, request.id, formData, phoneNumber);

      // Start polling DB for status
      this.startStatusPolling(phoneNumber, request.id, service);
    } catch (error) {
      logger.error('Verification initiation failed', error);
      await whatsappService.sendMessage(phoneNumber,
        "❌ Error connecting to backend systems. Please try again later."
      );
    }
  }

  private startStatusPolling(phoneNumber: string, requestId: number, service: string) {
    const table = this.getTableName(service);
    let attempts = 0;
    const maxAttempts = 30; // 30 * 4 seconds = 2 minutes max

    const interval = setInterval(async () => {
      attempts++;

      try {
        const [request] = await sql`SELECT status FROM ${sql(table)} WHERE id = ${requestId}`;

        if (request && request.status === 'pdf_verified') {
          clearInterval(interval);

          await this.updateSession(phoneNumber, { currentStep: 'awaiting_confirmation' });

          const buttons = [
            { id: "confirm_yes", title: "Yes, Download" },
            { id: "confirm_no", title: "No, Stop" }
          ];

          await whatsappService.sendReplyButtons(
            phoneNumber,
            `✅ *Record Found!*\n\nI have successfully verified the details on the portal. Would you like to download the PDF for ₹${this.serviceConfigs[service].price}?`,
            buttons
          );
        }
        else if (request && (request.status === 'failed' || request.status === 'failed_not_found') || attempts > maxAttempts) {
          clearInterval(interval);
          await whatsappService.sendMessage(phoneNumber,
            "❌ Record not found or portal error. Please check the details and try again."
          );
          await this.clearSession(phoneNumber);
        }
      } catch (error) {
        logger.error('Error polling status:', error);
      }
    }, 4000); // Poll every 4 seconds
  }

  /**
   * Create service request in appropriate database table
   */
  private async createServiceRequest(service: string, whatsappId: string, formData: Record<string, any>): Promise<any> {
    const table = this.getTableName(service);

    let result;

    if (service === 'property-card') {
      // Property Card specific insert
      result = await sql`
        INSERT INTO ${sql(table)} 
        (region, district, office, village, cts_no, whatsapp_phone, status)
        VALUES (
          ${formData.region}, 
          ${formData.district}, 
          ${formData.office}, 
          ${formData.village}, 
          ${formData.gat_no}, 
          ${whatsappId}, 
          'verifying'
        )
        RETURNING *
      `;
    } else if (service === '7-12') {
      // 7-12 has sheet_no
      result = await sql`
        INSERT INTO ${sql(table)} 
        (district, taluka, village, gat_no, sheet_no, whatsapp_phone, status)
        VALUES (
          ${formData.district}, 
          ${formData.taluka}, 
          ${formData.village}, 
          ${formData.gat_no}, 
          ${formData.sheet_no || null}, 
          ${whatsappId}, 
          'verifying'
        )
        RETURNING *
      `;
    } else {
      // Default for 8a and ferfar
      result = await sql`
        INSERT INTO ${sql(table)} 
        (district, taluka, village, gat_no, whatsapp_phone, status)
        VALUES (
          ${formData.district}, 
          ${formData.taluka}, 
          ${formData.village}, 
          ${formData.gat_no}, 
          ${whatsappId}, 
          'verifying'
        )
        RETURNING *
      `;
    }

    return result[0];
  }

  /**
   * Queue task in RabbitMQ
   */
  private async queueTask(service: string, requestId: number, formData: any, phoneNumber: string): Promise<boolean> {
    try {
      const amqp = await import('amqplib');
      const conn = await amqp.connect(process.env.RABBITMQ_URL || 'amqp://localhost');
      const channel = await conn.createChannel();

      let queueName;
      let payload;

      if (service === 'property-card') {
        queueName = 'property_card_queue';
        payload = {
          id: requestId,
          doc_type: 'property_card',
          region: formData.region,
          district: formData.district,
          office: formData.office,
          village: formData.village,
          cts_no: formData.gat_no,
          whatsapp_phone: phoneNumber
        };
      } else if (service === 'ferfar') {
        queueName = 'ferfar_queue';
        payload = {
          id: requestId,
          doc_type: 'ferfar',
          district: formData.district,
          taluka: formData.taluka,
          village: formData.village,
          gat_no: formData.gat_no,
          whatsapp_phone: phoneNumber
        };
      } else if (service === '7-12') {
        queueName = '7_12_queue';
        payload = {
          id: requestId,
          doc_type: '7_12',
          district: formData.district,
          taluka: formData.taluka,
          village: formData.village,
          gat_no: formData.gat_no,
          sheet_no: formData.sheet_no || null,
          whatsapp_phone: phoneNumber
        };
      } else if (service === '8a') {
        queueName = '8a_queue';
        payload = {
          id: requestId,
          doc_type: '8a',
          district: formData.district,
          taluka: formData.taluka,
          village: formData.village,
          gat_no: formData.gat_no,
          whatsapp_phone: phoneNumber
        };
      } else {
        return false;
      }

      channel.sendToQueue(queueName, Buffer.from(JSON.stringify(payload)), { persistent: true });

      setTimeout(() => {
        channel.close();
        conn.close();
      }, 500);

      logger.info(`📤 Task queued for ${service} - Request ID: ${requestId} in queue: ${queueName}`);
      return true;
    } catch (error) {
      logger.error('RabbitMQ Error', error);
      return false;
    }
  }

  /**
   * Handle payment success
   */
  async handlePaymentSuccess(phoneNumber: string, orderId: string): Promise<void> {
    try {
      const session = await this.getSession(phoneNumber);

      if (session.currentService && session.requestId) {
        const table = this.getTableName(session.currentService);
        await sql`UPDATE ${sql(table)} SET status = 'paid' WHERE id = ${session.requestId}`;
        logger.info(`💰 Request ${session.requestId} status set to PAID in ${table}`);
      }

      await whatsappService.sendMessage(
        phoneNumber,
        "✅ *Payment Received!* Thank you.\n\nYour document is now being generated. Please stay online, it will be sent to you shortly."
      );

      await this.updateSession(phoneNumber, {
        currentStep: 'processing_final_download'
      });
    } catch (error: any) {
      logger.error('❌ Error in handlePaymentSuccess:', error.message);
    }
  }

  // ==========================================
  // FINAL DOCUMENT DELIVERY
  // ==========================================
  async sendCompletedDocument(phoneNumber: string, service: string, requestId: number, pdfPath: string, filename: string): Promise<boolean> {
    try {
      const config = this.serviceConfigs[service];
      const caption = `✅ Your *${config.displayName}* is ready!\n\n📄 Request ID: ${requestId}\n\nThank you for using our service!`;

      const success = await whatsappService.sendDocument(phoneNumber, pdfPath, filename, caption);

      if (success) {
        const table = this.getTableName(service);
        await sql`
          UPDATE ${sql(table)} 
          SET status = 'completed', pdf_url = ${filename}, updated_at = NOW() 
          WHERE id = ${requestId}
        `;
        await this.clearSession(phoneNumber);
        return true;
      }
      return false;
    } catch (error: any) {
      logger.error('Failed to send final document', error);
      return false;
    }
  }
}

export const sessionManager = new SessionManagerService()