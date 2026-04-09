import { Hono } from 'hono';
import jwtAuthMiddleware from '../middleware/jwt.middleware.js';
import { createPayload, getSophTokens, logOut, verifySignature } from '../controllers/wallet.controller.js';

const app = new Hono();

app.get('/fetch-payload/:address', createPayload);

app.post('/verify-sign', verifySignature);

app.post('/logout', jwtAuthMiddleware, logOut);

app.get('/fetch-tokens', getSophTokens);

export default app;
