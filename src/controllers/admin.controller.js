import { AdminService } from '../services/AdminService.js';
import { ChatService } from '../services/ChatService.js';
import FormData from 'form-data';
import { SuccessResponse } from '../lib/success.res.js';
import { ErrorResponse } from '../lib/error.res.js';
import { addImageToLibrary, fetchAllImages } from '../services/imageLibraryService.js';
import { ENV } from '../configs/constant.js';
import fs from 'node:fs/promises';
import path from 'node:path';

const adminService = new AdminService();
const chatService = new ChatService();

/**
 * login - Handles admin login by validating credentials and invoking the AdminService.
 * @param {Object} c - The HTTP context object.
 * @returns {Promise<void>} - Resolves with the login response.
 */
const login = async (c) => {
    try {
        const authHeader = c.req.header('Authorization');

        if (!authHeader || !authHeader.startsWith('Basic ')) {
            throw ErrorResponse.badRequest('Invalid Credentials');
        }

        const encodedCredentials = authHeader.split(' ')[1];

        const decodedCredentials = Buffer.from(encodedCredentials, 'base64').toString('utf-8');

        const [email, password] = decodedCredentials.split(':');

        if (!email || !password) {
            throw ErrorResponse.badRequest('Invalid credentials');
        }
        const loginDetails = await adminService.login(email, password, c);
        return SuccessResponse.ok(c, loginDetails, 'Admin logged in successfully');
    } catch (error) {
        throw error;
    }
};

/**
 * dashboard - Fetches analytics data for the admin dashboard.
 * @param {Object} c - The HTTP context object.
 * @returns {Promise<void>} - Resolves with dashboard analytics data.
 */
const dashboard = async (c) => {
    try {
        const recentRegisteredUsers = await adminService.getRecentRegisteredUser();
        const registeredUsersCount = await adminService.getRegisteredUsersCount();
        const averageSessionTime = await chatService.getAverageSessionTime();
        const averagePointConsumption = await adminService.getAveragePoints();
        const topQuestions = [
            'Latest advancements in AI?',
            'Latest ChatGPT update',
            'Who is Sophia?',
            'What is the SOPH token?',
            'How can I create my own cryptocurrency?',
            'Future of AI in the upcoming years',
            'What is Augmented Reality?'
        ];
        const data = {
            registeredUsersCount: registeredUsersCount || 0,
            recentRegisteredUsers: recentRegisteredUsers || 0,
            averageSessionTime: averageSessionTime.success ? averageSessionTime.data : 'N/A',
            averagePointConsumption: Array.isArray(averagePointConsumption) ? averagePointConsumption : [],
            topQuestionsAsked: topQuestions.length ? topQuestions : []
        };
        return SuccessResponse.ok(c, data, 'Users Analytics fetched successfully');
    } catch (error) {
        throw error;
    }
};

/**
 * getAllUsers - Retrieves a paginated list of all users based on query parameters.
 * @param {Object} c - The HTTP context object.
 * @returns {Promise<void>} - Resolves with a list of users.
 */
const getAllUsers = async (c) => {
    const { pageIndex, pageSize, sort, search } = c.req.query();
    try {
        const users = await adminService.getAllUsers(search, sort, pageSize, pageIndex);
        return SuccessResponse.ok(c, users.data, 'users list fetched successfully');
    } catch (error) {
        throw error;
    }
};

/**
 * getUserSpecificDetails - Fetches details of a specific user by ID.
 * @param {Object} c - The HTTP context object.
 * @returns {Promise<void>} - Resolves with the user's details.
 */
const getUserSpecificDetails = async (c) => {
    const userId = c.req.param('userId');
    try {
        const userDetails = await adminService.getUserDetailsById(userId);
        const userAdditionalDetails = await chatService.getUserDetails(userId);
        const data = {
            name: userDetails.name,
            email: userDetails.email,
            profilePhoto: userDetails.profilePhoto || null,
            walletAddress: userDetails.walletAddress,
            storageConsumed: userDetails.storageConsumed || 'N/A',
            pointsSpent: userDetails.pointsSpent || 'N/A',
            questionsAsked: userAdditionalDetails?.data?.getUserQuestionsCount || 'N/A',
            joinedOn: userDetails.joinedOn,
            totalTimeSpent: userAdditionalDetails?.data?.getTotalTimeSpent || 'N/A',
            userMonthlyQuestions: userAdditionalDetails?.data?.getUserMonthlyQuestionsCount || []
        };
        return SuccessResponse.ok(c, data, 'user details fetched successuflly');
    } catch (error) {
        throw error;
    }
};

/**
 * getAdminProfile - Retrieves the admin's profile.
 * @param {Object} c - The HTTP context object.
 * @returns {Promise<Object>} - Resolves with the admin's profile data.
 */
const getAdminProfile = async (c) => {
    try {
        const { adminId } = c.get('admin');
        const adminProfile = await adminService.getAdminProfile(adminId);
        return SuccessResponse.ok(c, adminProfile, 'Admin profile retrieved successfully');
    } catch (error) {
        throw error;
    }
};

/**
 * logOut - Handles admin logout by invalidating the session.
 * @param {Object} c - The HTTP context object.
 * @returns {Promise<void>} - Resolves with the logout confirmation.
 */
const logOut = async (c) => {
    try {
        const authHeader = c.req.header('Authorization');
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            throw ErrorResponse.badRequest('Invalid token');
        }

        try {
            await adminService.logout(c);
            return SuccessResponse.ok(c, {}, 'Admin logout successfully');
        } catch (error) {
            if (error.name === 'TokenExpiredError') {
                throw ErrorResponse.unauthorized('Token has already expired');
            }
            throw ErrorResponse.unauthorized('Invalid token');
        }
    } catch (error) {
        throw error;
    }
};

/**
 * refreshToAccessToken - Refreshes the access token using a valid refresh token.
 * @param {Object} c - The HTTP context object.
 * @returns {Promise<Object>} - Resolves with the new access token.
 */
const refreshToAccessToken = async (c) => {
    try {
        const refreshToken = c.req
            .header('cookie')
            ?.split('; ')
            .find((cookie) => cookie.startsWith('refreshToken='))
            ?.split('=')[1];
        if (!refreshToken) {
            throw ErrorResponse.unauthorized('Refresh token is missing');
        }
        const newAccessToken = await adminService.refreshToAccessToken(c);
        if (!newAccessToken) {
            throw ErrorResponse.internalServerError('Failed to generate new session');
        }
        return SuccessResponse.ok(c, newAccessToken, 'New access token generated successfully');
    } catch (error) {
        throw error;
    }
};

/**
 * checkProfile - Validates the admin's current password.
 * @param {Object} c - The HTTP context object.
 * @returns {Promise<Object>} - Resolves with password validation response.
 */
const checkProfile = async (c) => {
    const { adminId } = c.get('admin');
    const data = await c.req.json();
    try {
        const isPasswordValid = await adminService.checkProfile(adminId, data.password.trim());
        if (isPasswordValid) {
            return SuccessResponse.ok(c, {}, 'Password is correct');
        } else {
            return ErrorResponse.unauthorized('Incorrect current password');
        }
    } catch (error) {
        throw error;
    }
};

/**
 * updateProfile - Updates the admin's profile information.
 * @param {Object} c - The HTTP context object.
 * @returns {Promise<Object>} - Resolves with the updated profile data.
 */
const updateProfile = async (c) => {
    try {
        const { adminId } = c.get('admin');
        const data = await c.req.json();
        const updatedResult = await adminService.updateProfile(adminId, data);
        return SuccessResponse.ok(c, updatedResult, 'Profile updated successfully');
    } catch (error) {
        throw error;
    }
};

/**
 * createPersonality - Handles the creation of a new personality.
 * @param {Object} c - The HTTP context object.
 * @returns {Promise<Object>} - Resolves with the response data for the created personality.
 */
const createPersonality = async (c) => {
    try {
        const body = await c.req.formData();
        const parsedBody = Object.fromEntries(body);

        const files = body.getAll('file');
        const formData = new FormData();
        if (parsedBody.name) formData.append('name', parsedBody.name);
        if (parsedBody.brainId) formData.append('brainId', parsedBody.brainId);
        if (parsedBody.category) formData.append('category', parsedBody.category);
        if (parsedBody.description) formData.append('description', parsedBody.description);
        if (parsedBody.avatarImg) formData.append('avatarImg', parsedBody.avatarImg);
        if (parsedBody.linkedinUrl) formData.append('linkedinUrl', parsedBody.linkedinUrl);

        if (files) {
            for (const file of files) {
                const buffer = await file.arrayBuffer();
                const stream = Buffer.from(buffer);
                formData.append('file', stream, {
                    filename: file.name,
                    contentType: file.type
                });
            }
        }

        const response = await adminService.createPersonality(formData);

        return SuccessResponse.ok(c, response.data, 'Personality created successfully');
    } catch (error) {
        throw error;
    }
};

/**
 * getSpecificPersonality - Retrieves details of a specific personality by ID.
 * @param {Object} c - The HTTP context object.
 * @returns {Promise<Object>} - Resolves with the details of the requested personality.
 */
const getSpecificPersonality = async (c) => {
    try {
        const { personalityId } = c.req.param();

        const response = await adminService.getSpecificPersonality(personalityId);

        return SuccessResponse.ok(c, response.data, 'Personality fetched successfully');
    } catch (error) {
        throw error;
    }
};

/**
 * getAllPersonalities - Fetches the list of all personalities.
 * @param {Object} c - The HTTP context object.
 * @returns {Promise<Object>} - Resolves with the list of all personalities.
 */
const getAllPersonalities = async (c) => {
    try {
        const response = await adminService.getAllPersonalities();
        return SuccessResponse.ok(c, response, 'Fetched all personalities successfully');
    } catch (error) {
        throw error;
    }
};

/**
 * editPersonality - Updates details of an existing personality.
 * @param {Object} c - The HTTP context object.
 * @returns {Promise<Object>} - Resolves with the updated personality details.
 */
const editPersonality = async (c) => {
    try {
        const personalityId = c.req.param('personalityId');
        const body = await c.req.formData();
        const parsedBody = Object.fromEntries(body);

        const formData = new FormData();
        if (parsedBody.name) formData.append('name', parsedBody.name);
        if (parsedBody.brainId) formData.append('brainId', parsedBody.brainId);
        if (parsedBody.category) formData.append('category', parsedBody.category);
        if (parsedBody.description) formData.append('description', parsedBody.description);
        if (parsedBody.avatarImg) formData.append('avatarImg', parsedBody.avatarImg);
        if (parsedBody.linkedinUrl) formData.append('linkedinUrl', parsedBody.linkedinUrl);



        console.log('formData---->>', formData);

        const files = body.getAll('file');
        if (files) {
            for (const file of files) {
                const buffer = await file.arrayBuffer();
                const stream = Buffer.from(buffer);
                formData.append('file', stream, {
                    filename: file.name,
                    contentType: file.type
                });
            }
        }

        const response = await adminService.editPersonality(personalityId, formData);
        return SuccessResponse.ok(c, response.data, 'Personality updated successfully');
    } catch (error) {
        throw error;
    }
};

/**
 * deletePersonality - Deletes a personality by ID.
 * @param {Object} c - The HTTP context object.
 * @returns {Promise<void>} - Resolves with a confirmation of deletion.
 */
const deletePersonality = async (c) => {
    try {
        const personalityId = c.req.param('personalityId');
        const response = await adminService.deletePersonality(personalityId);
        return SuccessResponse.ok(c, {}, 'Personality deleted successfully');
    } catch (error) {
        throw error;
    }
};

const validateElevenLabsVoiceId = async (c) => {
    try {
        const brainId = c.req.param('brainId');
        const validationResult = await adminService.validateElevenLabsVoiceId(brainId);
        if (validationResult.success) {
            return SuccessResponse.ok(c, {}, validationResult.message);
        }
    } catch (error) {
        throw error;
    }
};

const deleteFile = async (c) => {
    try {
        const { fileId, personalityId, fileName } = c.req.query();
        if (!fileId || !personalityId || !fileName) {
            throw ErrorResponse.badRequest('Missing required query parameters');
        }
        const deleteFileResponse = await adminService.deleteFile(fileId, personalityId, fileName);
        return SuccessResponse.ok(c, {}, deleteFileResponse.message);
    } catch (error) {
        throw error;
    }
};

/**
 * uploadImageToLibrary - Handles local file storage and DB entry.
 */
const uploadImageToLibrary = async (c) => {
    try {
        const formData = await c.req.formData();
        const file = formData.get('image');
        const description = formData.get('description'); 
        const tags = formData.get('tags');

        if (!file || !description) {
            throw ErrorResponse.badRequest('Image file and description are required');
        }

        // 1. Generate local file path
        const fileName = `${Date.now()}-${file.name.replace(/\s+/g, '-')}`;
        const uploadDir = path.join(process.cwd(), 'public', 'uploads');
        
        // 2. Create the folder in local repo if it doesn't exist
        await fs.mkdir(uploadDir, { recursive: true });

        const filePath = path.join(uploadDir, fileName);
        
        // 3. Write binary to disk
        const buffer = await file.arrayBuffer();
        await fs.writeFile(filePath, Buffer.from(buffer));

        // Store app-relative URL so it works across localhost and production hosts.
        const url = `/api/v1/uploads/${fileName}`;
        const newImage = await addImageToLibrary({ url, description, tags });

        return SuccessResponse.ok(c, newImage, 'Image uploaded locally successfully');
    } catch (error) {
        throw error;
    }
};

const getImageLibrary = async (c) => {
    try {
        const images = await fetchAllImages();
        return SuccessResponse.ok(c, images, 'Image library fetched successfully');
    } catch (error) {
        throw error;
    }
};

export {
    login,
    dashboard,
    getAllUsers,
    getUserSpecificDetails,
    getAdminProfile,
    logOut,
    refreshToAccessToken,
    checkProfile,
    updateProfile,
    createPersonality,
    getSpecificPersonality,
    getAllPersonalities,
    editPersonality,
    deletePersonality,
    validateElevenLabsVoiceId,
    deleteFile,
    uploadImageToLibrary,
    getImageLibrary
};
