import { Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { registerSchema } from '../utils/validationSchema.js';
import { ErrorResponse } from '../lib/error.res.js';
import { ENV } from '../configs/constant.js';
import { z } from 'zod';
import axios from 'axios';
import prisma from '../lib/prisma.js';

export class AdminService {
    /**
     * Retrieves an admin user by email.
     * @param {string} email - The admin's email address.
     * @returns {Promise<Object>} The admin user data.
     * @throws {ErrorResponse} If the admin does not exist.
     */
    async getAdminByEmail(email) {
        const admin = await prisma.admin.findUnique({
            where: {
                email: email
            }
        });
        if (!admin) {
            throw ErrorResponse.badRequest('Admin does not exist with this email');
        }
        return admin;
    }

    /**
     * Retrieves the profile of an admin user by ID.
     * @param {string} adminId - The ID of the admin.
     * @returns {Promise<Object>} The admin profile data.
     * @throws {ErrorResponse} If the admin is not found.
     */
    async getAdminProfile(adminId) {
        const admin = await prisma.admin.findUnique({
            where: { id: adminId },
            select: {
                name: true,
                email: true,
                profilePhoto: true
            }
        });
        if (!admin) {
            throw ErrorResponse.notFound('Admin not found');
        }
        return {
            id: admin.id,
            name: admin.name,
            email: admin.email,
            profilePhoto: admin.profilePhoto
        };
    }

    /**
     * Finds an admin user by their ID.
     * @param {string} id - The admin's ID.
     * @returns {Promise<Object>} The admin user data.
     * @throws {ErrorResponse} If the admin is not found.
     */
    async findAdminByAdminId(id) {
        const admin = await prisma.admin.findUnique({
            where: { id }
        });
        if (!admin) {
            throw ErrorResponse.notFound('Admin not found');
        }
        return admin;
    }

    /**
     * Logs in an admin user using email and password.
     * @param {string} email - The admin's email.
     * @param {string} password - The admin's password.
     * @param {Object} context - The HTTP context object.
     * @returns {Promise<Object>} The admin info and JWT token.
     * @throws {ErrorResponse} If the login fails.
     */
    async login(email, password, context) {
        const adminExist = await prisma.admin.findUnique({
            where: { email }
        });
        if (!adminExist) {
            throw ErrorResponse.notFound('Admin not found');
        }
        const isPasswordValid = await bcrypt.compare(password, adminExist.password);
        if (!isPasswordValid) {
            throw ErrorResponse.unauthorized('Invalid email or password');
        }
        const payload = {
            id: adminExist.id,
            name: adminExist.name,
            email: adminExist.email
        };
        let refreshTime = '2d';
        let accessTime = '2d';
        if (ENV.NODE_ENV == 'development') {
            accessTime = '1d';
        }
        const token = await this.generateNewSession(payload, accessTime, refreshTime, context);
        if (!token) {
            throw ErrorResponse.internalServerError('Error saving token');
        }
        context.set('id', payload.id);
        return {
            AdminInfo: {
                ...payload
            },
            token
        };
    }

    /**
     * Refreshes the access token using a valid refresh token.
     * @param {Object} context - The HTTP context object.
     * @returns {Promise<Object>} An object containing the admin info and new access token.
     * @throws {ErrorResponse} If the refresh token is missing, expired, invalid, or if generating a new session fails.
     */
    async refreshToAccessToken(context) {
        const refreshToken = context.req
            .header('cookie')
            ?.split('; ')
            .find((cookie) => cookie.startsWith('refreshToken='))
            ?.split('=')[1];

        if (!refreshToken) {
            throw ErrorResponse.unauthorized('Refresh Token is missing or invalid');
        }
        let decoded;
        try {
            decoded = jwt.verify(refreshToken, ENV.JWT_SECRET);
        } catch (err) {
            if (err.name === 'TokenExpiredError') {
                throw ErrorResponse.unauthorized('Refresh token has expired');
            }
            if (err.name === 'JsonWebTokenError') {
                throw ErrorResponse.unauthorized('Refresh token is invalid');
            }
            throw ErrorResponse.internalServerError('Failed to verify token');
        }
        const { ...payload } = decoded;
        const token = await this.generateNewSession(payload, '10s', null, context);
        if (!token) {
            throw ErrorResponse.internalServerError('Failed to generate a new session');
        }
        return {
            AdminInfo: payload,
            token
        };
    }

    /**
     * Generates a new JWT session with access and optional refresh tokens.
     * @param {Object} payload - The token payload data.
     * @param {string} accessSessionTime - Expiry time for the access token.
     * @param {string|null} refreshSessionTime - Expiry time for the refresh token.
     * @param {Object} context - The HTTP context object.
     * @returns {Promise<string>} The access token.
     * @throws {ErrorResponse} If token generation fails.
     */
    async generateNewSession(payload, accessSessionTime, refreshSessionTime = null, context) {
        const secretKey = ENV.JWT_SECRET;
        if (!secretKey) {
            throw ErrorResponse.internalServerError('JWT secret key is missing');
        }

        const { exp, ...restPayload } = payload;

        let accessToken;
        try {
            accessToken = jwt.sign(restPayload, secretKey, {
                expiresIn: accessSessionTime
            });
        } catch (error) {
            throw ErrorResponse.internalServerError('Error generating access token');
        }

        if (refreshSessionTime) {
            let refreshToken;
            try {
                refreshToken = jwt.sign(payload, secretKey, {
                    expiresIn: refreshSessionTime
                });
            } catch (error) {
                throw ErrorResponse.internalServerError('Error generating refresh token');
            }

            try {
                const refreshTokenMaxAge = AdminService.convertToMilliseconds(refreshSessionTime) / 1000;
                const cookie = `refreshToken=${refreshToken}; HttpOnly; Max-Age=${refreshTokenMaxAge}; Secure; SameSite=None; Path=/`;
                context.res.headers.append('Set-Cookie', cookie);
            } catch (error) {
                throw ErrorResponse.internalServerError('Error setting refresh token cookie');
            }
        }

        return accessToken;
    }

    /**
     * Converts a time string (e.g., '1d', '2h') to milliseconds.
     * @param {string} time - The time string to convert.
     * @returns {number} The time in milliseconds.
     */
    static convertToMilliseconds(time) {
        const value = parseInt(time.slice(0, -1), 10);
        const unit = time.slice(-1);
        const multiplier = {
            d: 86400000,
            h: 3600000,
            m: 60000,
            s: 1000
        };
        return value * (multiplier[unit] || 0);
    }

    /**
     * Calculates the average points for each month across all users.
     * @returns {Array} List of months with average points.
     * @throws {ErrorResponse} If no user data is found.
     */
    async getAveragePoints() {
        const usersData = [
            {
                name: 'User1',
                points: [10, 20, 15, 30, 25, 40, 35, 50, 45, 60, 55, 70]
            },
            {
                name: 'User2',
                points: [5, 15, 10, 25, 20, 35, 30, 45, 40, 55, 50, 65]
            },
            {
                name: 'User3',
                points: [8, 18, 12, 28, 22, 38, 32, 48, 42, 58, 52, 68]
            }
        ];

        const monthlyTotals = Array.from({ length: 12 }, () => 0);

        usersData.forEach((user) => {
            user.points.forEach((points, index) => {
                monthlyTotals[index] += points;
            });
        });

        const numberOfUsers = usersData.length;
        const AveragePoints = monthlyTotals.map((total) => total / numberOfUsers);

        const months = Array.from({ length: 12 }, (_, i) => {
            const monthName = new Date(0, i).toLocaleString('en-US', {
                month: 'long'
            });
            return { month: monthName, AveragePoints: AveragePoints[i].toFixed(2) };
        });

        return months;
    }

    /**
     * Logs out the user and invalidates the tokens.
     * @param {Object} context - The request and response context.
     * @returns {boolean} True if logout is successful.
     * @throws {ErrorResponse} If no valid tokens are provided.
     */
    async logout(context) {
        const parseCookies = (cookieHeader) => {
            const cookies = {};
            if (!cookieHeader) return cookies;

            const cookieArray = cookieHeader.split(';');
            cookieArray.forEach((cookie) => {
                const [key, value] = cookie.split('=');
                cookies[key.trim()] = value ? value.trim() : '';
            });
            return cookies;
        };

        const authHeader = context.req.header('Authorization');
        const cookieHeader = context.req.header('Cookie');
        const cookies = parseCookies(cookieHeader);
        const refreshTokenCookie = cookies.refreshToken;
        if (!authHeader && !refreshTokenCookie) {
            throw ErrorResponse.unauthorized('No valid tokens provided for logout');
        }
        let tokens = [];
        if (authHeader) {
            tokens.push(authHeader.split(' ')[1]);
        }
        if (refreshTokenCookie) {
            tokens.push(refreshTokenCookie);
            context.res.headers.append('Set-Cookie', `refreshToken=; Max-Age=0; HttpOnly; Path=/`);
        }
        tokens.forEach((token) => {
            revokedTokens.add(token);
        });
        return true;
    }

    /**
     * Retrieves the total count of registered users.
     * @returns {number} The total number of registered users.
     * @throws {ErrorResponse} If no registered users are found.
     */
    async getRegisteredUsersCount() {
        const count = await prisma.user.count();
        if (count === 0) {
            throw ErrorResponse.notFound('No registered users found');
        }
        return count;
    }

    /**
     * Retrieves the count of users registered within the last week.
     * @returns {number} The count of recent users.
     * @throws {ErrorResponse} If no users registered in the last week.
     */
    async getRecentRegisteredUser() {
        const oneWeekAgo = new Date();
        oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

        const recentUsersCount = await prisma.user.count({
            where: {
                createdAt: {
                    gte: oneWeekAgo
                }
            }
        });

        if (recentUsersCount === 0) {
            throw ErrorResponse.notFound('No users registered in the last week');
        }

        return recentUsersCount;
    }

    /**
     * Retrieves a paginated list of all users with optional search and sort.
     * @param {string} search - Search query for user name.
     * @param {string} sort - Sorting direction (asc/desc).
     * @param {number} pageSize - Number of users per page.
     * @param {number} pageIndex - Page index for pagination.
     * @returns {Object} Paginated user list with metadata.
     * @throws {ErrorResponse} If no users are found.
     */
    async getAllUsers(search, sort, pageSize, pageIndex) {
        pageIndex = parseInt(pageIndex) || 1;
        pageSize = parseInt(pageSize) || 10;

        const whereClause = search
            ? {
                  OR: [{ name: { contains: search, mode: 'insensitive' } }]
              }
            : {};

        const orderByClause = { createdAt: sort || 'asc' };

        const totalCount = await prisma.user.count({
            where: whereClause
        });

        if (totalCount === 0) {
            throw ErrorResponse.notFound('No users found');
        }

        const users = await prisma.user.findMany({
            where: whereClause,
            select: {
                id: true,
                name: true,
                profilePhoto: true,
                wallet: {
                    select: {
                        address: true
                    }
                },
                createdAt: true
            },
            orderBy: orderByClause,
            skip: (pageIndex - 1) * pageSize,
            take: pageSize
        });

        const usersList = users.map((user) => ({
            ...user,
            walletAddress: user.wallet?.address,
            joinedOn: user.createdAt,
            createdAt: undefined,
            wallet: undefined
        }));

        const totalPages = Math.ceil(totalCount / pageSize);

        return {
            message: 'Users list fetched successfully',
            data: {
                usersList,
                tableData: {
                    search: search || '',
                    totalUsers: totalCount,
                    totalPages,
                    pageIndex,
                    pageSize,
                    hasNextPage: pageIndex < totalPages,
                    hasPreviousPage: pageIndex > 1,
                    sortDirection: sort || 'asc'
                }
            }
        };
    }

    /**
     * Retrieves user details by their ID.
     * @param {string} userId - The user's unique ID.
     * @returns {Object} The user's details.
     * @throws {ErrorResponse} If the user is not found.
     */
    async getUserDetailsById(userId) {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: {
                name: true,
                email: true,
                wallet: {
                    select: {
                        address: true
                    }
                },
                profilePhoto: true,
                createdAt: true
            }
        });

        if (!user) {
            throw ErrorResponse.notFound('User not found');
        }

        const userDetails = {
            ...user,
            walletAddress: user.wallet?.address,
            joinedOn: user.createdAt,
            storageConsumed: '0 MB',
            pointsSpent: '0 SOPH',
            wallet: undefined,
            createdAt: undefined
        };

        return userDetails;
    }

    /**
     * Checks the validity of the admin's password.
     * @param {string} adminId - The unique ID of the admin.
     * @param {string} password - The password provided by the admin.
     * @returns {Promise<boolean>} True if the password is valid, false otherwise.
     * @throws {ErrorResponse} If the admin is not found or the password is incorrect.
     */
    async checkProfile(adminId, password) {
        const admin = await prisma.admin.findUnique({
            where: { id: adminId }
        });
        if (!admin) {
            throw ErrorResponse.notFound('Admin not found');
        }
        const isValid = await bcrypt.compare(password, admin.password);
        return isValid;
    }

    /**
     * Updates the profile of the admin.
     * @param {string} adminId - The unique ID of the admin.
     * @param {Object} data - The data to update the admin profile.
     * @param {string} [data.name] - The new name for the admin.
     * @param {string} [data.email] - The new email for the admin.
     * @param {string} [data.password] - The new password for the admin.
     * @param {string} [data.profilePhoto] - The new profile photo for the admin.
     * @returns {Promise<Object>} The updated admin profile.
     * @throws {ErrorResponse} If the admin is not found or validation fails.
     */
    async updateProfile(adminId, data) {
        const updatedData = {};
        if (data.name) updatedData.name = data.name;
        if (data.email) {
            const emailSchema = z.string().email();
            try {
                emailSchema.parse(data.email);
                updatedData.email = data.email;
            } catch (error) {
                throw ErrorResponse.unprocessableEntity('Invalid email format');
            }
        }
        if (data.password) {
            try {
                registerSchema.pick({ password: true }).parse({ password: data.password });
                const hashedPassword = await bcrypt.hash(data.password.trim(), 10);
                updatedData.password = hashedPassword;
            } catch (error) {
                throw ErrorResponse.unprocessableEntity(error.errors.map((e) => e.message).join(' '));
            }
        }

        if (data.profilePhoto) {
            updatedData.profilePhoto = data.profilePhoto;
        }

        const adminExists = await prisma.admin.findUnique({
            where: { id: adminId }
        });
        if (!adminExists) {
            throw ErrorResponse.notFound('Admin not found');
        }

        const updatedProfile = await prisma.admin.update({
            where: { id: adminId },
            data: updatedData
        });
        const { password, permissions, role, ...filteredProfile } = updatedProfile;
        return filteredProfile;
    }

    /**
     * Creates a new personality profile via an external API.
     * @param {FormData} formData - The form data to create the personality.
     * @returns {Promise<Object>} The response from the external API.
     * @throws {ErrorResponse} If the personality creation fails.
     */
    async createPersonality(formData) {
        const { data: response } = await axios.post(`${ENV.BASE_URL}/personality/createPersonality`, formData, {
            headers: {
                'persona-api-key': ENV.PERSONA_API_KEY,
                ...formData.getHeaders()
            }
        });

        if (!response.success) {
            throw ErrorResponse.internalServerError('Failed to create personality');
        }

        return response;
    }

    /**
     * Retrieves a specific personality by ID from the external API.
     * @param {string} personalityId - The unique ID of the personality.
     * @returns {Promise<Object>} The response from the external API.
     * @throws {ErrorResponse} If the personality fetch fails.
     */
    async getSpecificPersonality(personalityId) {
        const { data: response } = await axios.get(`${ENV.BASE_URL}/personality/${personalityId}`, {
            headers: {
                'persona-api-key': ENV.PERSONA_API_KEY
            }
        });

        if (!response.success) {
            throw ErrorResponse.internalServerError('Failed to fetch specific personality');
        }
        return response;
    }

    /**
     * Retrieves a list of all personalities from the external API.
     * @returns {Promise<Object>} The list of personalities.
     * @throws {ErrorResponse} If the fetch fails.
     */
    async getAllPersonalities() {
        const { data: response } = await axios.get(`${ENV.BASE_URL}/personality/get/personalities`, {
            headers: {
                'persona-api-key': ENV.PERSONA_API_KEY
            }
        });

        if (!response) {
            throw ErrorResponse.internalServerError('Failed to fetch personalities');
        }

        return response;
    }

    /**
     * Updates a personality via the external API.
     * @param {string} personalityId - The unique ID of the personality.
     * @param {FormData} formData - The form data to update the personality.
     * @returns {Promise<Object>} The response from the external API.
     * @throws {ErrorResponse} If the personality update fails.
     */
    async editPersonality(personalityId, formData) {
        const { data: response } = await axios.put(`${ENV.BASE_URL}/personality/edit/${personalityId}`, formData, {
            headers: {
                'persona-api-key': ENV.PERSONA_API_KEY,
                ...formData.getHeaders()
            }
        });

        if (!response.success) {
            throw ErrorResponse.internalServerError('Failed to update personality');
        }

        return response;
    }

    /**
     * Deletes a personality via the external API.
     * @param {string} personalityId - The unique ID of the personality.
     * @returns {Promise<Object>} The response from the external API.
     * @throws {ErrorResponse} If the personality deletion fails.
     */
    async deletePersonality(personalityId) {
        const { data: response } = await axios.delete(`${ENV.BASE_URL}/personality/${personalityId}`, {
            headers: {
                'persona-api-key': ENV.PERSONA_API_KEY
            }
        });

        if (!response.success) {
            throw ErrorResponse.internalServerError('Failed to delete personality');
        }

        return response;
    }

    /**
     * Validates a given ElevenLabs voice ID by checking its existence via the ElevenLabs API.
     * @param {string} brainId - The ID of the voice to be validated.
     * @returns {object} - An object containing `success` and `message` if the voice ID is validated successfully.
     * @throws {ErrorResponse} - Throws a `notFound` error if the voice ID is invalid or not found.
     */
    async validateElevenLabsVoiceId(brainId) {
        try {
            const response = await axios.get(`${ENV.ELEVEN_LABS_API_URL}/${brainId}`, {
                headers: {
                    'xi-api-key': ENV.ELEVENLABS_API_KEY
                }
            });
            if (response.status === 200) {
                return {
                    success: true,
                    message: 'Voice ID validated successfully'
                };
            }
        } catch (error) {
            console.error('Error response from ElevenLabs:', error.response?.data || error.message);
            if (error.response?.data?.detail?.status === 'voice_not_found') {
                throw ErrorResponse.notFound(`A voice for the voice_id ${brainId} was not found.`);
            } else {
                throw ErrorResponse.notFound('Invalid Voice Id');
            }
        }
    }

    /**
     * Deletes a file associated with a specific personality using an external API.
     * @param {string} fileId - The unique identifier of the file to be deleted.
     * @param {string} personalityId - The unique identifier of the personality associated with the file.
     * @param {string} fileName - The name of the file to be deleted.
     * @returns {object} - The response object from the external API indicating the success of the operation.
     * @throws {ErrorResponse} - Throws `notFound` if the file is not found, or `internalServerError` for other errors.
     */
    async deleteFile(fileId, personalityId, fileName) {
        try {
            const { data: response } = await axios.delete(`${ENV.BASE_URL}/personality/file`, {
                params: { fileId, personalityId, fileName },
                headers: {
                    'persona-api-key': ENV.PERSONA_API_KEY
                }
            });

            if (!response.success) {
                throw new Error('Failed to delete file from an external API.');
            }

            return response;
        } catch (error) {
            if (error.response.data.message === 'File not found.') {
                throw ErrorResponse.notFound(error.response.data.message);
            }
            throw ErrorResponse.internalServerError(`${error.response.data.message || 'Unknown error'}`);
        }
    }
}
