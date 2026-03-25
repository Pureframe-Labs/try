import 'dotenv/config';
import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';
import { logger } from 'hono/logger';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import amqp from 'amqplib';
import { supabase } from './db';
import { existsSync, mkdirSync } from 'fs';

import webhookRoutes from './routes/webhook.routes';
import paymentRoutes from './routes/payment.routes';
import modulesRoutes from './routes/modules.routes';
import testRoutes from './routes/test.routes';

// -------------------------------------------------
// STARTUP VALIDATION
// -------------------------------------------------
const requiredEnv = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'RABBITMQ_URL'];
for (const env of requiredEnv) {
    if (!process.env[env]) {
        console.error(`❌ FATAL: Missing required environment variable: ${env}`);
        console.error(`   Please set this variable in your hosting provider's Dashboard (e.g. Render, Railway).`);
        process.exit(1);
    }
}

const app = new Hono();

// -------------------------------------------------
// GLOBAL MIDDLEWARES & ERROR HANDLING
// -------------------------------------------------
app.use('*', logger());
app.use('*', cors());
app.use('*', secureHeaders());

app.onError((err, c) => {
    console.error(`❌ [Global Error] ${c.req.method} ${c.req.url}:`, err.message);
    return c.json({ success: false, error: 'Internal Server Error' }, 500);
});

let channel: any = null;
let mqConnection: any = null;

// -------------------------------------------------
// RABBITMQ INITIALIZATION
// -------------------------------------------------
async function initRabbitMQ() {
    try {
        const mqUrl = process.env.RABBITMQ_URL || 'amqp://localhost';
        
        // Protocol Validation to catch "got https:" early
        if (mqUrl.startsWith('http')) {
            console.error("❌ FATAL: RABBITMQ_URL starts with http/https. RabbitMQ requires amqp:// or amqps://");
            console.error("   Please check your hosting dashboard or .env file.");
            process.exit(1);
        }

        mqConnection = await amqp.connect(mqUrl);
        channel = await mqConnection.createChannel();
        
        // Declare all queues
        await channel.assertQueue('property_card_queue', { durable: true });
        await channel.assertQueue('ferfar_queue', { durable: true });
        await channel.assertQueue('7_12_queue', { durable: true });
        await channel.assertQueue('8a_queue', { durable: true });
        
        console.log("✅ RabbitMQ Connected - All Queues Ready");
    } catch (err: any) {
        console.error("❌ RabbitMQ Failed:", err.message || err);
        console.log("⏳ Retrying RabbitMQ connection in 5 seconds...");
        setTimeout(initRabbitMQ, 5000);
    }
}

initRabbitMQ();

// Create download directories
['property_card', 'ferfar', 'satBara'].forEach(dir => {
    const path = `./downloads/${dir}`;
    if (!existsSync(path)) mkdirSync(path, { recursive: true });
});

// -------------------------------------------------
// REGISTER MODULAR ROUTES
// -------------------------------------------------
app.route('/webhook', webhookRoutes);
app.route('/payment', paymentRoutes);
app.route('/api', modulesRoutes);
app.route('/test', testRoutes);

// -------------------------------------------------
// FILE SERVING ENDPOINTS
// -------------------------------------------------
app.use('/files/property-card/*', serveStatic({ root: './downloads/property_card' }));
app.use('/files/ferfar/*', serveStatic({ root: './downloads/ferfar' }));
app.use('/files/satbara/*', serveStatic({ root: './downloads/satBara' }));

// -------------------------------------------------
// HEALTH CHECK
// -------------------------------------------------
app.get('/health', (c) => {
    return c.json({ 
        status: 'ok', 
        rabbitmq: channel ? 'connected' : 'disconnected',
        timestamp: new Date().toISOString()
    });
});

export default app;

console.log("🚀 Unified Land Records Server Running");
console.log("📋 Endpoints Active via Modular Routes:");
console.log("  /webhook/whatsapp - WhatsApp Webhook");
console.log("  /payment/*        - Payment Flow");
console.log("  /api/*            - Land Record Modules");
console.log("  /test/*           - Dev Testing (Non-Prod)");
console.log("  /health           - Health check");

// -------------------------------------------------
// GRACEFUL SHUTDOWN
// -------------------------------------------------
const shutdown = async (signal: string) => {
    console.log(`\n⏳ Received ${signal}. Shutting down gracefully...`);
    try {
        if (channel) {
            console.log("Closing RabbitMQ channel...");
            await channel.close();
        }
        if (mqConnection) {
            console.log("Closing RabbitMQ connection...");
            await mqConnection.close();
        }
    } catch (err: any) {
        console.error("❌ Error during shutdown:", err.message);
    }
    console.log("✅ Graceful shutdown complete. Exiting process.");
    process.exit(0);
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));