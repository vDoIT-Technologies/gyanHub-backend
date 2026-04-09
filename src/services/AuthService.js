import { Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { AdminService } from './AdminService.js';
import { EmailService } from './EmailService.js';
import { WalletService } from './WalletService.js';
import { ErrorResponse } from '../lib/error.res.js';
import { ENV } from '../configs/constant.js';
import axios from 'axios';
import prisma from '../lib/prisma.js';

const adminService = new AdminService();
const emailService = new EmailService();
const walletService = new WalletService();

export class AuthService {
    /**
     * Registers a new user, sends a verification email, and generates a session token.
     * @param {string} name - User's full name.
     * @param {string} email - User's email address.
     * @param {string} password - User's password.
     * @param {Object} c - HTTP context object.
     * @returns {Promise<Object>} A success message and email.
     * @throws {ErrorResponse} If the email is already in use or another error occurs.
     */
    async register(name, email, password, c) {
        const existingUser = await prisma.user.findUnique({
            where: { email }
        });

        if (existingUser) {
            throw ErrorResponse.conflict('User already exists with this email');
        }

        const payload = {
            name: name,
            email: email,
            password: password
        };

        const origin = c.req.header('Origin');
        let refreshTime = '2d';
        let accessTime = '2d';
        if (ENV.NODE_ENV == 'development') {
            accessTime = '1d';
        }
        const token = await adminService.generateNewSession(payload, accessTime, refreshTime, c);
        if (!token) {
            throw ErrorResponse.internalServerError('Error Saving token');
        }

        const text = `Thank you for signing up!  You're just one step away from accessing all the features.`;
        const textBelow = `from the signup page`;
        const emailTransport = await emailService.sendSignUpEmail(
            email,
            token,
            `${origin}/login`,
            name,
            text,
            textBelow
        );
        if (emailTransport.success) {
            return {
                message:
                    'A verification email has been sent to your email address. Please check your inbox to verify your account.',
                data: email
            };
        } else {
            throw ErrorResponse.internalServerError('Failed to send verification email');
        }
    }

    /**
     * Verifies a user's account using a token, creates a wallet, and stores user details.
     * @param {string} token - Verification token.
     * @returns {Promise<Object>} A success message.
     * @throws {ErrorResponse} If the token is invalid, expired, or user creation fails.
     */
    async verifyAccount(token) {
        const decodedToken = jwt.verify(token, ENV.JWT_SECRET);

        const currentTime = Math.floor(Date.now() / 1000);
        const tokenAge = currentTime - decodedToken.iat;

        if (tokenAge > 900) {
            throw ErrorResponse.badRequest('Your token has expired. Please sign in again.');
        }

        const password = await bcrypt.hash(decodedToken.password, 10);
        const email = decodedToken.email;

        const existingUser = await prisma.user.findUnique({
            where: { email: email }
        });

        if (existingUser && existingUser.type == 'email') {
            throw ErrorResponse.badRequest('user is already verified. Please continue with login');
        }

        const response = await walletService.generateWallet(email);

        const { data: res } = await axios.post(
            `${ENV.BASE_URL}/user/create`,
            {},
            {
                headers: {
                    'persona-api-key': ENV.PERSONA_API_KEY
                }
            }
        );
        if (!res) {
            throw ErrorResponse.internalServerError('Failed to get response from the persona');
        }

        const wallet = response.data;

        const createdWallet = await prisma.wallet.create({
            data: {
                address: wallet.address,
                metadata: wallet.metadata || {}
            }
        });

        if (!createdWallet) {
            throw ErrorResponse.internalServerError('Error creating wallet');
        }

        const user = await prisma.user.create({
            data: {
                id: res.data.id,
                name: decodedToken.name,
                email,
                password,
                walletId: createdWallet.id,
                type: 'email'
            }
        });
        if (!user) {
            throw ErrorResponse.internalServerError('Failed to create user with the walletId');
        }

        return { message: 'Account verified successfully' };
    }

    /**
     * Logs in a user by validating email and password and returns a session token.
     * @param {string} email - User's email.
     * @param {string} password - User's password.
     * @param {Object} context - HTTP context object.
     * @returns {Promise<Object>} User details and session token.
     * @throws {ErrorResponse} If the user doesn't exist or password is invalid.
     */
    async login(email, password, context) {
        const userExist = await prisma.user.findUnique({
            where: { email },
            select: {
                id: true,
                name: true,
                email: true,
                password: true,
                type: true,
                wallet: {
                    select: {
                        address: true
                    }
                }
            }
        });
        if (!userExist) {
            throw ErrorResponse.badRequest('User does not exist');
        }
        const isPasswordValid = await bcrypt.compare(password, userExist.password);
        if (!isPasswordValid) {
            throw ErrorResponse.badRequest('Invalid email or password');
        }

        const payload = {
            userId: userExist.id,
            userName: userExist.name,
            email: userExist.email,
            sophTokens: {
                bncTokens: '0.0',
                ethTokens: '0.0'
            },
            type: userExist.type,
            wallet: userExist.wallet?.address
        };
        let refreshTime = '2d';
        let accessTime = '2d';
        if (ENV.NODE_ENV == 'development') {
            accessTime = '1d';
        }

        const token = await adminService.generateNewSession(payload, accessTime, refreshTime, context);
        if (!token) {
            throw ErrorResponse.internalServerError('Error saving token');
        }
        context.set('id', payload.id);
        return {
            UserInfo: {
                ...payload
            },
            token
        };
    }

    /**
     * Sends a password reset email to the user.
     * @param {string} email - User's email address.
     * @param {Object} c - HTTP context object.
     * @returns {Promise<Object>} Success message and email.
     * @throws {ErrorResponse} If the user doesn't exist or email fails to send.
     */
    async forgotPassword(email, c) {
        email = email.toLowerCase();
        const userExist = await prisma.user.findUnique({
            where: { email }
        });
        if (!userExist) {
            throw ErrorResponse.badRequest('User does not exist with this email');
        }
        const origin = c.req.header('Origin');
        const payload = {
            id: userExist.id,
            name: userExist.name,
            email: userExist.email,
            password: userExist.password
        };
        let refreshTime = '2d';
        let accessTime = '2d';
        if (ENV.NODE_ENV == 'development') {
            accessTime = '1d';
        }
        const token = await adminService.generateNewSession(payload, accessTime, refreshTime, c);
        if (!token) {
            throw ErrorResponse.badRequest('Error saving token');
        }
        const text = `We received a request to reset your password. Click the button below to set a new password.`;
        const textBelow = `If you did not request this, please ignore this email.`;

        const emailTransport = await emailService.sendResetEmail(
            email,
            token,
            `${origin}/reset-password`,
            userExist.name,
            text,
            textBelow
        );

        if (emailTransport.success) {
            return {
                message: 'A password reset email has been sent to your email address. Please check your inbox.',
                data: email
            };
        } else {
            throw ErrorResponse.internalServerError('Failed to send password email');
        }
    }

    /**
     * Resets the user's password using a token.
     * @param {string} token - Password reset token.
     * @param {string} password - New password.
     * @returns {Promise<Object>} Success message.
     * @throws {ErrorResponse} If the token is invalid or user update fails.
     */
    async resetPassword(token, password) {
        const decodedToken = jwt.verify(token, ENV.JWT_SECRET);

        const user = await prisma.user.findUnique({
            where: {
                email: decodedToken.email
            }
        });
        if (!user) {
            throw ErrorResponse.badRequest('User not found with the provided email');
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const updatedUser = await prisma.user.update({
            where: {
                email: decodedToken.email
            },
            data: {
                password: hashedPassword
            }
        });

        if (!updatedUser) {
            throw ErrorResponse.internalServerError('Failed to update the password. Please try again');
        }

        return {
            message: 'Password has been reset successfully.'
        };
    }
}
