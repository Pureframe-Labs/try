import { Hono } from 'hono';
import { whatsappService } from '../services/whatsapp.service';
import { logger } from '../utils/logger';

const diagRoutes = new Hono();

diagRoutes.get('/whatsapp-test', async (c) => {
    const to = c.req.query('to') || '917987266831';
    const baseUrl = process.env.BASE_URL || '';
    const phoneNumberId = process.env.PHONE_NUMBER_ID || '';
    const apiKey = process.env.API_KEY || '';

    const tests = [
        { name: "Standard (ID in Path)", url: `${baseUrl}/${phoneNumberId}/messages` },
        { name: "No ID (Base/messages)", url: `${baseUrl}/messages` },
        { name: "No ID (Base/v19.0/messages)", url: `${baseUrl}/v19.0/messages` },
        { name: "Query Param Auth", url: `${baseUrl}/${phoneNumberId}/messages?access_token=${apiKey}`, noAuthHeader: true },
        { name: "No ID + Query Param", url: `${baseUrl}/messages?access_token=${apiKey}`, noAuthHeader: true },
        { name: "ApiKey Header", url: `${baseUrl}/${phoneNumberId}/messages`, customHeaders: { 'ApiKey': apiKey }, noAuthHeader: true },
        { name: "X-API-Key Header", url: `${baseUrl}/${phoneNumberId}/messages`, customHeaders: { 'X-API-Key': apiKey }, noAuthHeader: true },
    ];

    const results = [];

    for (const test of tests) {
        logger.info(`🧪 Testing URL: ${test.name} -> ${test.url}`);
        const payload = {
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: to,
            type: "text",
            text: { body: `Diag Test: ${test.name}` }
        };

        try {
            const headers: any = { 'Content-Type': 'application/json' };
            if (!test.noAuthHeader) {
                headers['Authorization'] = `Bearer ${apiKey}`;
            }
            if ((test as any).customHeaders) {
                Object.assign(headers, (test as any).customHeaders);
            }
            
            const resp = await fetch(test.url, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(payload)
            });
            const status = resp.status;
            const body = await resp.text();
            results.push({ name: test.name, status, body });
            logger.info(`🧪 Result ${test.name}: ${status} ${body}`);
        } catch (err: any) {
            results.push({ name: test.name, error: err.message });
        }
    }

    return c.json({ results });
});

export default diagRoutes;
