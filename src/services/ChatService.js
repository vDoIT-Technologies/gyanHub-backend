import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import { ErrorResponse } from '../lib/error.res.js';
import { ENV } from '../configs/constant.js';

const prisma = new PrismaClient();

export class ChatService {
    /**
     * Creates a new chat session.
     * @param {string} userId - The ID of the user.
     * @param {string} title - The title of the chat session.
     * @returns {object} - The response from the session creation API.
     * @throws {ErrorResponse} - If the session creation fails.
     */
    async createSession(userId, personalityId) {
        const { data: response } = await axios.post(
            `${ENV.BASE_URL}/chat/createSession`,
            { userId, personalityId },
            {
                headers: {
                    'persona-api-key': ENV.PERSONA_API_KEY
                }
            }
        );

        if (!response.success) {
            throw ErrorResponse.internalServerError('Failed to get response from persona LLM');
        }
        return response;
    }

    /**
     * Fetches a specific chat session.
     * @param {string} sessionId - The ID of the session to fetch.
     * @returns {object} - The session data.
     * @throws {ErrorResponse} - If the session is not found.
     */
    async getSession(sessionId) {
        const { data: response } = await axios.get(`${ENV.BASE_URL}/chat/sessions/${sessionId}`, {
            headers: {
                'persona-api-key': ENV.PERSONA_API_KEY
            }
        });

        if (!response) {
            throw ErrorResponse.notFound('Chat Session not found');
        }
        return response;
    }

    /**
     * Finds matching memory for a given user and input.
     * @param {string} message - The input text for which matching memory is to be found.
     * @param {string} userId - The ID of the user.
     */

    async referencechat(message, userId) {
        const { data: response } = await axios.post(
            `${ENV.BASE_URL}/chat/chatreference`,
            {
                answer: message,
                userId: userId
            },
            {
                headers: {
                    'persona-api-key': ENV.PERSONA_API_KEY
                }
            }
        );
        if (!response.success) {
            throw ErrorResponse.internalServerError('Failed to fetch chat reference.');
        }
        return response;
    }

    /**
     * Sends a message in an existing chat session.
     * @param {string} sessionId - The ID of the session.
     * @param {string} message - The message to send.
     * @param {string} userId - The ID of the user sending the message.
     * @param {string} personalityId - The personality ID of the chat.
     * @returns {object} - The response from the API.
     * @throws {ErrorResponse} - If sending the message fails.
     */
    async chat(sessionId, message, userId, personalityId, wordLimit, modelName) {
        const { data: response } = await axios.post(
            `${ENV.BASE_URL}/chat/create`,
            {
                sessionId: sessionId,
                message: message,
                userId: userId,
                personalityId: personalityId,
                wordLimit: wordLimit,
                modelName: modelName
            },
            {
                headers: {
                    'persona-api-key': ENV.PERSONA_API_KEY
                }
            }
        );
        if (!response.success) {
            throw ErrorResponse.internalServerError('Failed to get response from persona LLM');
        }

        return response;
    }

    /**
     * Retrieves the chat session history.
     * @param {string} sessionId - The ID of the session.
     * @returns {object} - The session history.
     * @throws {ErrorResponse} - If fetching the session history fails.
     */
    async getSessionHistory(sessionId) {
        const { data: response } = await axios.get(`${ENV.BASE_URL}/chat/sessions/${sessionId}/history`, {
            headers: {
                'persona-api-key': ENV.PERSONA_API_KEY
            }
        });
        if (!response) {
            throw ErrorResponse.internalServerError('Failed to get response from persona LLM');
        }
        return response;
    }

    /**
     * Fetches paginated chat sessions for a user.
     * @param {string} userId - The ID of the user whose sessions are to be fetched.
     * @param {number} pageIndex - The index of the page to fetch.
     * @param {number} pageSize - The number of sessions per page.
     * @param {string} sort - The sorting order (e.g., "asc" or "desc").
     * @param {string} search - The search term for filtering sessions.
     * @returns {object} - The paginated session data.
     * @throws {ErrorResponse} - If fetching paginated sessions fails.
     */
    async getSessionsPaginated(userId, pageIndex, pageSize, sort, search) {
        const { data: response } = await axios.get(`${ENV.BASE_URL}/chat/sessions`, {
            params: {
                userId,
                pageIndex,
                pageSize,
                sort,
                search
            },
            headers: {
                'persona-api-key': ENV.PERSONA_API_KEY
            }
        });
        if (!response) {
            throw ErrorResponse.internalServerError('Failed to clear session history from Persona LLM');
        }

        return response;
    }

    /**
     * Clears the history of a specific chat session.
     * @param {string} sessionId - The ID of the session to clear.
     * @returns {boolean} - True if the history was cleared.
     * @throws {ErrorResponse} - If clearing the session history fails.
     */
    async clearSessionHistory(sessionId) {
        const { data: response } = await axios.delete(`${ENV.BASE_URL}/chat/sessions/${sessionId}/history`, {
            headers: {
                'persona-api-key': ENV.PERSONA_API_KEY
            }
        });
        if (!response) {
            throw ErrorResponse.internalServerError('Failed to clear session history from Persona LLM');
        }
        return true;
    }

    /**
     * Deletes a chat session by its ID.
     * @param {string} sessionId - The ID of the session to delete.
     * @returns {boolean} - True if the session was deleted.
     * @throws {ErrorResponse} - If deleting the session fails.
     */
    async deleteSessionById(sessionId) {
        const { data: response } = await axios.delete(`${ENV.BASE_URL}/chat/session/${sessionId}`, {
            headers: {
                'persona-api-key': ENV.PERSONA_API_KEY
            }
        });
        if (!response) {
            throw ErrorResponse.internalServerError('Failed to delete the specific session from LLM');
        }
        return true;
    }

    /**
     * Edits the title of a specific session.
     * @param {string} sessionId - The ID of the session to edit.
     * @param {string} title - The new title of the session.
     * @returns {object} - The updated session data.
     * @throws {ErrorResponse} - If editing the session fails.
     */
    async editSessionById(sessionId, title) {
        const { data: response } = await axios.put(
            `${ENV.BASE_URL}/chat/sessions/${sessionId}`,
            { title },
            {
                headers: {
                    'persona-api-key': ENV.PERSONA_API_KEY
                }
            }
        );
        if (!response) {
            throw ErrorResponse.internalServerError('Failed to delete the specific session from LLM');
        }

        return response;
    }

    /**
     * Fetches the average session time from the Persona API.
     * @returns {object} - The average session time.
     * @throws {ErrorResponse} - If fetching the session time fails.
     */
    async getAverageSessionTime() {
        const { data: response } = await axios.get(`${ENV.BASE_URL}/chat/sessions-averageTime`, {
            headers: {
                'persona-api-key': ENV.PERSONA_API_KEY
            }
        });
        if (!response) {
            throw ErrorResponse.internalServerError('Failed to get the session average time from the persona');
        }

        return response;
    }

    /**
     * Retrieves the details of a specific user.
     * @returns {object} - The user details.
     * @throws {ErrorResponse} - If fetching the user details fails.
     */
    async getUserDetails(userId) {
        const { data: response } = await axios.get(`${ENV.BASE_URL}/chat/fetch-userDetails`, {
            params: { userId },
            headers: {
                'persona-api-key': ENV.PERSONA_API_KEY
            }
        });
        if (!response) {
            throw ErrorResponse.internalServerError('Failed to get the session average time from the persona');
        }

        return response;
    }

    /**
     * Saves a conversation between the human user and the AI in a chat session.
     * @param {string} sessionId - The ID of the chat session where the conversation took place.
     * @param {string} userId - The ID of the user involved in the conversation.
     * @param {string} messageHuman - The message sent by the human user.
     * @param {string} messageAi - The message generated by the AI.
     * @param {string} personalityId - The ID of the personality used by the AI in the chat session.
     * @returns {object} - The response from the Persona API, confirming the message was saved.
     * @throws {ErrorResponse} - If saving the chat fails (e.g., if the API response indicates failure).
     */
    async saveBenSnetChat(sessionId, userId, messageHuman, messageAi, personalityId) {
        const { data: response } = await axios.post(
            `${ENV.BASE_URL}/chat/save`,
            {
                sessionId: sessionId,
                userId: userId,
                messageHuman: messageHuman,
                messageAi: messageAi,
                personalityId: personalityId
            },
            {
                headers: {
                    'persona-api-key': ENV.PERSONA_API_KEY
                }
            }
        );

        if (!response.success) {
            throw ErrorResponse.internalServerError('Failed to get response from persona LLM');
        }

        return response;
    }

    /**
     * Generates a title for a chat session based on the provided message and session ID.
     * @param {string} message - The message used as a basis for title generation.
     * @param {string} sessionId - The ID of the chat session for which the title is being generated.
     * @returns {object} - The response from the Persona API containing the generated title.
     * @throws {ErrorResponse} - If the title generation fails (e.g., if the API response indicates failure).
     */
    async chatTitleGeneration(message, sessionId) {
        const { data: response } = await axios.post(
            `${ENV.BASE_URL}/chat/titleGeneration`,
            {
                sessionId: sessionId,
                message: message
            },
            {
                headers: {
                    'persona-api-key': ENV.PERSONA_API_KEY
                }
            }
        );
        if (!response.sucess) {
            throw ErrorResponse.internalServerError('Failed to get response from persona LLM');
        }
        return response;
    }

    async close() {
        await prisma.$disconnect();
    }
}
