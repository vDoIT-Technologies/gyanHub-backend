import { Hono } from 'hono';
import {
    createChat,
    createSession,
    deleteSessionById,
    deleteSessionHistory,
    editSessionById,
    getAllSessions,
    getSessionById,
    getSessionHistory
} from '../controllers/chat.controller';
import { sunitaChat } from '../controllers/llm.controller.js';
import { natashaChat } from '../controllers/natasha.controller.js';
import { getVisibleAvatarTeachers, getTeacherConfig } from '../controllers/avatarTeacher.controller.js';

const app = new Hono();

app.post('/create-session', createSession);

app.get('/fetch-sessions', getAllSessions);

app.get('/fetch-session/:sessionId', getSessionById);

app.post('/create/:sessionId', createChat);

app.get('/session-history/:sessionId', getSessionHistory);

app.delete('/session-history/:sessionId', deleteSessionHistory);

app.delete('/sessions/:sessionId', deleteSessionById);

app.put('/sessions/:sessionId', editSessionById);

app.post('/ai-response', sunitaChat);
app.post('/teacher-response', natashaChat);

// ── Public avatar teacher endpoints ───────────────────────────────────────
app.get('/avatar-teachers', getVisibleAvatarTeachers);
app.get('/teacher-config/:teacherId', getTeacherConfig);

export default app;
