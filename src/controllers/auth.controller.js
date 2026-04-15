import { z } from 'zod';
import { registerSchema, resetPasswordSchema } from '../utils/validationSchema.js';
import { AuthService } from '../services/AuthService.js';
import { SuccessResponse } from '../lib/success.res.js';
import { ErrorResponse } from '../lib/error.res.js';

const authService = new AuthService();

/**
 * register - Handles user registration.
 * @param {Object} c - The HTTP context object.
 * @returns {Promise<void>} - Resolves with the registration response.
 */
const register = async (c) => {
    try {
        const body = await c.req.json();
        let { name, email, password } = registerSchema.parse(body);
        email = email.toLowerCase();
        const registerDetails = await authService.register(name, email, password, c);
        return SuccessResponse.ok(c, registerDetails.data, registerDetails.message);
    } catch (error) {
        if (error instanceof z.ZodError) {
            const errors = error.errors.map((err) => ({
                field: err.path[0],
                message: err.message
            }));

            return c.json(
                {
                    success: false,
                    message: 'Validation failed',
                    errors: errors
                },
                400
            );
        }
        throw error;
    }
};

/**
 * verifyAccount - Verifies a user's account using a token.
 * @param {Object} c - The HTTP context object.
 * @returns {Promise<void>} - Resolves with the verification response.
 */
const verifyAccount = async (c) => {
    try {
        const { token } = await c.req.json();
        if (!token) {
            return c.json({ success: false, message: 'Token is required' }, 400);
        }

        const verificationResult = await authService.verifyAccount(token);
        return SuccessResponse.ok(c, {}, verificationResult.message);
    } catch (error) {
        throw error;
    }
};

/**
 * login - Handles user login using Basic Auth.
 * @param {Object} c - The HTTP context object.
 * @returns {Promise<void>} - Resolves with the login response.
 */
const login = async (c) => {
    try {
        const authHeader = c.req.header('Authorization');

        if (!authHeader || !authHeader.startsWith('Basic ')) {
            throw ErrorResponse.badRequest('Invalid credentials');
        }

        const encodedCredentials = authHeader.split(' ')[1];

        const decodedCredentials = Buffer.from(encodedCredentials, 'base64').toString('utf-8');

        const [email, password] = decodedCredentials.split(':');

        if (!email || !password) {
            throw ErrorResponse.badRequest('Invalid credentials');
        }
        const loginDetails = await authService.login(email, password, c);
        return SuccessResponse.ok(c, loginDetails, 'User logged in successfully');
    } catch (error) {
        throw error;
    }
};

/**
 * forgotPassword - Handles forgot password requests.
 * @param {Object} c - The HTTP context object.
 * @returns {Promise<void>} - Resolves with the forgot password response.
 */
const forgotPassword = async (c) => {
    try {
        const { email } = await c.req.json();
        if (!email) {
            throw ErrorResponse.badRequest('Email is required');
        }
        const response = await authService.forgotPassword(email, c);
        return SuccessResponse.ok(c, response.data, response.message);
    } catch (error) {
        throw error;
    }
};

/**
 * resetPassword - Resets the user's password using a token.
 * @param {Object} c - The HTTP context object.
 * @returns {Promise<void>} - Resolves with the reset password response.
 */
const resetPassword = async (c) => {
    try {
        const { token, password } = await c.req.json();

        resetPasswordSchema.parse({ password });
        if (!token) {
            throw ErrorResponse.badRequest('Token is required for password reset');
        }
        const response = await authService.resetPassword(token, password);
        return SuccessResponse.ok(c, {}, response.message);
    } catch (error) {
        if (error instanceof z.ZodError) {
            const errors = error.errors.map((err) => ({
                field: err.path[0],
                message: err.message
            }));

            return c.json(
                {
                    success: false,
                    message: 'Validation failed',
                    errors: errors
                },
                400
            );
        }
        throw error;
    }
};
export { register, verifyAccount, login, forgotPassword, resetPassword };
