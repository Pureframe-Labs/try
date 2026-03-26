import 'dotenv/config';
import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';
import { logger } from 'hono/logger';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import amqp from 'amqplib';
import { existsSync, mkdirSync } from 'fs';

// --- 1. CONFIG & VALIDATION ---
const PORT = process.env.PORT || 8080;
const requiredEnv = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'RABBITMQ_URL'];

for (const env of requiredEnv) {
    if (!process.env[env]) {
        console.error(`❌ FATAL: Missing environment variable: ${env}`);
        process.exit(1);
    }
}

const app = new Hono();

// --- 2. MIDDLEWARES ---
app.use('*', secureHeaders());
app.use('*', cors());
// Only log in development to save CPU cycles on Railway
if (process.env.NODE_ENV !== 'production') {
    app.use('*', logger());
}

// --- 3. RABBITMQ SINGLETON ---
let channel: amqp.Channel | null = null;
let mqConnection: amqp.Connection | null = null;

async function initRabbitMQ() {
    try {
        const mqUrl = process.env.RABBITMQ_URL!;
        
        if (mqUrl.startsWith('http')) {
            throw new Error("RABBITMQ_URL must start with amqp:// or amqps://");
        }

        mqConnection = await amqp.connect(mqUrl);
        channel = await mqConnection.createChannel();
        
        // Parallel assertion for faster startup
        await Promise.all([
            channel.assertQueue('property_card_queue', { durable: true }),
            channel.assertQueue('ferfar_queue', { durable: true }),
            channel.assertQueue('7_12_queue', { durable: true }),
            channel.assertQueue('8a_queue', { durable: true })
        ]);
        
        console.log("✅ RabbitMQ Connected");

        // Handle connection closure
        mqConnection.on('close', () => {
            console.error("❌ MQ Connection closed. Retrying...");
            channel = null;
            setTimeout(initRabbitMQ, 5000);
        });

    } catch (err: any) {
        console.error(`❌ RabbitMQ Error: ${err.message}. Retrying in 5s...`);
        setTimeout(initRabbitMQ, 5000);
    }
}

// Fire and forget so the server starts immediately
initRabbitMQ();

// --- 4. FILESYSTEM SETUP ---
const DIRS = ['property_card', 'ferfar', 'satBara'];
DIRS.forEach(dir => {
    const path = `./downloads/${dir}`;
    if (!existsSync(path)) mkdirSync(path, { recursive: true });
});

// --- 5. ROUTES ---
// Import your routes (ensure these use 'export default router')
import webhookRoutes from './routes/webhook.routes';
import paymentRoutes from './routes/payment.routes';
import modulesRoutes from './routes/modules.routes';
import testRoutes from './routes/test.routes';

app.route('/webhook', webhookRoutes);
app.route('/payment', paymentRoutes);
app.route('/api', modulesRoutes);
app.route('/test', testRoutes);

// --- 6. STATIC SERVING ---
app.use('/files/property-card/*', serveStatic({ root: './downloads/property_card' }));
app.use('/files/ferfar/*', serveStatic({ root: './downloads/ferfar' }));
app.use('/files/satbara/*', serveStatic({ root: './downloads/satBara' }));

// --- 7. HEALTH CHECK (Critical for Railway) ---
app.get('/health', (c) => {
    return c.json({ 
        status: 'ok', 
        mq: channel ? 'connected' : 'connecting',
        uptime: process.uptime()
    }, channel ? 200 : 503); // Return 503 if MQ is down to prevent job ingestion
});

// --- 8. GRACEFUL SHUTDOWN ---
const shutdown = async (signal: string) => {
    console.log(`\n⏳ ${signal} - Closing connections...`);
    try {
        if (channel) await channel.close();
        if (mqConnection) await mqConnection.close();
        console.log("✅ Shutdown complete.");
        process.exit(0);
    } catch (e) {
        process.exit(1);
    }
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// --- 9. BUN ENTRY POINT ---
export default {
    port: PORT,
    fetch: app.fetch,
};

console.log(`🚀 Server running on port ${PORT}`);