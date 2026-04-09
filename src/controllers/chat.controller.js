import { ChatService } from '../services/ChatService';
import { SuccessResponse } from '../lib/success.res.js';
import { ErrorResponse } from '../lib/error.res.js';
import { ENV } from '../configs/constant.js';

const chatService = new ChatService(ENV.OPENAI_API_KEY, {
    host: ENV.PG_HOST,
    port: ENV.PG_PORT,
    database: ENV.PG_DATABASE,
    user: ENV.PG_USER,
    password: ENV.PG_PASSWORD
});

/**
 * createSession - Creates a new chat session.
 * @param {Object} c - The HTTP context object.
 * @returns {Promise<void>} - Resolves when the session is created.
 */
const createSession = async (c) => {
    try {
        const { userId, personalityId } = await c.req.json();
        const session = await chatService.createSession(userId, personalityId);
        return SuccessResponse.ok(c, session.data, session.message);
    } catch (error) {
        throw error;
    }
};

/**
 * getAllSessions - Retrieves all chat sessions for a user with pagination and sorting.
 * @param {Object} c - The HTTP context object.
 * @returns {Promise<void>} - Resolves when the sessions are retrieved.
 */
const getAllSessions = async (c) => {
    try {
        let { userId, pageIndex, pageSize, sort, search } = c.req.query();
        if (!userId) {
            throw ErrorResponse.badRequest('userId is required');
        }
        pageIndex = Number(pageIndex) || 1;
        pageSize = Number(pageSize) || 10;
        sort = sort || 'desc';

        if (isNaN(pageIndex) || isNaN(pageSize)) {
            throw ErrorResponse.badRequest('Invalid page or limit');
        }
        if (sort != 'asc' && sort != 'desc') {
            throw ErrorResponse.badRequest('Invalid sort direction');
        }

        const response = await chatService.getSessionsPaginated(userId, pageIndex, pageSize, sort, search);
        return SuccessResponse.ok(c, response.data, response.message);
    } catch (error) {
        throw error;
    }
};

/**
 * getSessionById - Retrieves a session by its unique ID.
 * @param {Object} c - The HTTP context object.
 * @returns {Promise<void>} - Resolves when the response is sent.
 */
const getSessionById = async (c) => {
    try {
        const sessionId = c.req.param('sessionId');
        const session = await chatService.getSession(sessionId);
        if (!session) {
            throw ErrorResponse.notFound('Session not found');
        }
        return SuccessResponse.ok(c, session);
    } catch (error) {
        throw error;
    }
};

/**
 * createChat - Creates a new chat message in the specified session.
 * @param {Object} c - The HTTP context object.
 * @returns {Promise<void>} - Resolves when the response is sent.
 */
const createChat = async (c) => {
    try {
        const sessionId = c.req.param('sessionId');
        const { message, userId, personalityId, wordLimit, modelName} = await c.req.json();
        const response = await chatService.chat(sessionId, message, userId, personalityId, wordLimit, modelName);
        return SuccessResponse.ok(c, response);
    } catch (error) {
        throw error;
    }
};

/**
 * getSessionHistory - Retrieves the message history of a specific chat session.
 * @param {Object} c - The HTTP context object.
 * @returns {Promise<void>} - Resolves when the history is retrieved.
 */
const getSessionHistory = async (c) => {
    try {
        const sessionId = c.req.param('sessionId');
        const history = await chatService.getSessionHistory(sessionId);
        return SuccessResponse.ok(c, history);
    } catch (error) {
        throw error;
    }
};

/**
 * deleteSessionHistory - Deletes the message history of a specific chat session.
 * @param {Object} c - The HTTP context object.
 * @returns {Promise<void>} - Resolves when the history is deleted.
 */
const deleteSessionHistory = async (c) => {
    try {
        const sessionId = c.req.param('sessionId');
        await chatService.clearSessionHistory(sessionId);
        return SuccessResponse.ok(c, {}, 'Session history cleared successfully');
    } catch (error) {
        throw error;
    }
};

/**
 * deleteSessionById - Deletes a specific chat session by ID.
 * @param {Object} c - The HTTP context object.
 * @returns {Promise<void>} - Resolves when the session is deleted.
 */
const deleteSessionById = async (c) => {
    try {
        const sessionId = c.req.param('sessionId');
        await chatService.deleteSessionById(sessionId);
        return SuccessResponse.ok(c, {}, 'Session history deleted successfully');
    } catch (error) {
        throw error;
    }
};

/**
 * editSessionById - Edits the title of a specific chat session.
 * @param {Object} c - The HTTP context object.
 * @returns {Promise<void>} - Resolves when the session is updated.
 */
const editSessionById = async (c) => {
    try {
        const sessionId = c.req.param('sessionId');

        const { title } = await c.req.json();

        const session = await chatService.editSessionById(sessionId, title);

        return SuccessResponse.ok(c, session, session.message);
    } catch (error) {
        throw error;
    }
};

export {
    createSession,
    getAllSessions,
    getSessionById,
    createChat,
    getSessionHistory,
    deleteSessionHistory,
    deleteSessionById,
    editSessionById
};
