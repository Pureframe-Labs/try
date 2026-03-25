/**
 * ============================================================================
 * MODULES ROUTES (Internal/Admin only)
 * ============================================================================
 * Routes for all 4 land record modules - INTERNAL USE ONLY
 * Users now interact via WhatsApp chat only
 */

import { Hono } from 'hono'
import * as Controller712 from '../controllers/7-12.controller'
import * as Controller8a from '../controllers/8a.controller'
import * as ControllerPropertyCard from '../controllers/property-card.controller'
import * as ControllerFerfar from '../controllers/ferfar.controller'
import { apiKeyAuth } from '../middlewares/auth.middleware'
import { sessionManager } from '@/services/session-manager.service'
import path from 'path'

const modulesRoutes = new Hono()

// Apply API key auth to all module routes
modulesRoutes.use('*', apiKeyAuth)

// ============================================================================
// 7-12 MODULE ROUTES (Internal only)
// ============================================================================

modulesRoutes.post('/7-12/request', Controller712.createSatbaraRequest)
modulesRoutes.get('/7-12/request/:id', Controller712.getSatbaraRequestStatus)
modulesRoutes.get('/7-12/user/:phone', Controller712.getSatbaraUserRequests)
modulesRoutes.get('/7-12/stats', Controller712.getSatbaraStats)
modulesRoutes.post('/complete', async (c) => {
  const { request_id, pdf_url, service, phone } = await c.req.json();
  
  // This triggers the WhatsApp delivery we wrote in session-manager.service.ts
  await sessionManager.sendCompletedDocument(
    phone, 
    service, 
    request_id, 
    pdf_url, 
    path.basename(pdf_url)
  );
  
  return c.json({ success: true });
});

// ============================================================================
// 8A MODULE ROUTES (Internal only)
// ============================================================================

modulesRoutes.post('/8a/request', Controller8a.create8aRequest)
modulesRoutes.get('/8a/request/:id', Controller8a.get8aRequestStatus)
modulesRoutes.get('/8a/user/:phone', Controller8a.get8aUserRequests)
modulesRoutes.get('/8a/stats', Controller8a.get8aStats)

// ============================================================================
// PROPERTY CARD MODULE ROUTES (Internal only)
// ============================================================================

modulesRoutes.post(
  '/property-card/request',
  ControllerPropertyCard.createPropertyCardRequest
)
modulesRoutes.get(
  '/property-card/request/:id',
  ControllerPropertyCard.getPropertyCardRequestStatus
)
modulesRoutes.get(
  '/property-card/user/:phone',
  ControllerPropertyCard.getPropertyCardUserRequests
)
modulesRoutes.get(
  '/property-card/stats',
  ControllerPropertyCard.getPropertyCardStats
)

// ============================================================================
// FERFAR MODULE ROUTES (Internal only)
// ============================================================================

modulesRoutes.post('/ferfar/request', ControllerFerfar.createFerfarRequest)
modulesRoutes.get('/ferfar/request/:id', ControllerFerfar.getFerfarRequestStatus)
modulesRoutes.get('/ferfar/user/:phone', ControllerFerfar.getFerfarUserRequests)
modulesRoutes.get('/ferfar/stats', ControllerFerfar.getFerfarStats)

export default modulesRoutes