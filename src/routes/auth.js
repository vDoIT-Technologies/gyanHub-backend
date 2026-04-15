import { Hono } from 'hono';
import { forgotPassword, login, register, resetPassword, verifyAccount } from '../controllers/auth.controller.js';

const app = new Hono();

app.post('/register', register);

app.post('/verify-account', verifyAccount);

app.post('/login', login);

app.post('/forgot-password', forgotPassword);

app.post('/reset-password', resetPassword);

export default app;
