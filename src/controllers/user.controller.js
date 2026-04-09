import { UserService } from '../services/UserService.js';
import { SuccessResponse } from '../lib/success.res.js';
import { ErrorResponse } from '../lib/error.res.js';
import { ENV } from '../configs/constant.js';
import axios from 'axios';
import { ChatService } from '../services/ChatService.js';

const userService = new UserService();
const chatService = new ChatService();

/**
 * getUserById - Retrieves user details by userId.
 * @param {Object} c - The HTTP context object.
 * @returns {Promise<void>} - Returns a promise that resolves when the response is sent.
 */
const getUserById = async (c) => {
    try {
        const { userId } = c.get('user');
        const user = await userService.getUserById(userId);
        return SuccessResponse.ok(c, user);
    } catch (error) {
        throw error;
    }
};

/**
 * updateSpecificUser - Updates a specific user's details.
 * @param {Object} c - The HTTP context object.
 * @returns {Promise<void>} - Returns a promise that resolves when the response is sent.
 */
const updateSpecificUser = async (c) => {
    try {
        const { userId } = c.get('user');
        const data = await c.req.json();
        const updatedData = {
            ...data,
            profilePhoto: data.profilePhoto
        };
        const updatedUser = await userService.updateUser(userId, updatedData);
        return SuccessResponse.ok(c, updatedUser);
    } catch (error) {
        throw error;
    }
};

/**
 * getUserAnalytics - Fetches user analytics data.
 * @param {Object} c - The HTTP context object.
 * @returns {Promise<void>} - Returns a promise that resolves when the response is sent.
 */
const getUserAnalytics = async (c) => {
    const { userId } = c.get('user');
    try {
        const userDetails = await chatService.getUserDetails(userId);
        const data = {
            totalTimeSpent: userDetails?.data?.getTotalTimeSpent || 'N/A',
            userQuestionsCount: userDetails?.data?.getUserQuestionsCount || 0,
            pointsConsumed: '0 SOPH',
            userMonthlyQuestions: userDetails?.data?.getUserMonthlyQuestionsCount || [],
            relevantTopics: [
                'Latest advancements in AI',
                'Latest ChatGPT update',
                'Who is Sophia',
                'What is SOPH token',
                'How can I create my own crypto',
                'Upcoming future of AI',
                'What is Augmented Reality?'
            ]
        };
        return SuccessResponse.ok(c, data, 'User Analytics fetched successfully');
    } catch (error) {
        throw error;
    }
};

/**
 * getPersonalityById - Retrieves a personality by ID.
 * @param {Object} c - The HTTP context object.
 * @returns {Promise<void>} - Returns a promise that resolves when the response is sent.
 */
const getPersonalityById = async (c) => {
    try {
        const { personalityId } = c.req.param();

        const { data: response } = await axios.get(`${ENV.BASE_URL}/personality/${personalityId}`, {
            headers: {
                'persona-api-key': ENV.PERSONA_API_KEY
            }
        });

        if (!response.success) {
            throw ErrorResponse.internalServerError('Failed to create Personality');
        }

        const responseData = {
            ...response.data,
            personalityId
        };

        return SuccessResponse.ok(c, responseData, 'Personality fetched successfully');
    } catch (error) {
        throw error;
    }
};

/**
 * getAllPersonalities - Retrieves all available personalities.
 * @param {Object} c - The HTTP context object.
 * @returns {Promise<void>} - Returns a promise that resolves when the response is sent.
 */
const getAllPersonalities = async (c) => {
    try {
        const { data: response } = await axios.get(`${ENV.BASE_URL}/personality/get/personalities`, {
            headers: {
                'persona-api-key': ENV.PERSONA_API_KEY
            }
        });

        if (!response) {
            throw ErrorResponse.internalServerError('Failed to fetch personalities');
        }

        return SuccessResponse.ok(c, response, 'Fetched all personalities successfully');
    } catch (error) {
        throw error;
    }
};

export { getUserById, updateSpecificUser, getUserAnalytics, getPersonalityById, getAllPersonalities };
