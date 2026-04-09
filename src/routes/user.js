import { Hono } from 'hono';
import jwtAuthMiddleware from '../middleware/jwt.middleware.js';
import {
    getAllPersonalities,
    getPersonalityById,
    getUserAnalytics,
    getUserById,
    updateSpecificUser
} from '../controllers/user.controller.js';

const app = new Hono();

app.get('/get', jwtAuthMiddleware, getUserById);

app.put('/update', jwtAuthMiddleware, updateSpecificUser);

app.get('/getAnalytics', jwtAuthMiddleware, getUserAnalytics);

app.get('/personality/:personalityId', jwtAuthMiddleware, getPersonalityById);

app.get('/fetch-allPersonalities', jwtAuthMiddleware, getAllPersonalities);

export default app;
