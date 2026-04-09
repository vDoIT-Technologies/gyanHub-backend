import { WalletService } from '../services/WalletService.js';
import { SuccessResponse } from '../lib/success.res.js';
import { ErrorResponse } from '../lib/error.res.js';
import { setCookie } from 'hono/cookie';

const walletService = new WalletService();

/**
 * createPayload - Generates a payload for wallet authentication.
 * @param {Object} c - The HTTP context object.
 * @returns {Promise<void>} - Returns a promise when the response is sent.
 */
const createPayload = async (c) => {
    const address = c.req.param('address');
    try {
        const payload = await walletService.createPayload(c.req, address);
        return SuccessResponse.ok(c, payload);
    } catch (error) {
        throw error;
    }
};

/**
 * verifySignature - Verifies the wallet signature and generates an authentication token.
 * @param {Object} c - The HTTP context object.
 * @returns {Promise<void>} - Returns a promise when the response is sent.
 */
const verifySignature = async (c) => {
    const { sign, address } = await c.req.json();
    let errMsg = '';
    if (!sign) {
        errMsg = 'sign required!';
    }
    if (!address) {
        errMsg = errMsg !== '' ? `sign, address required` : 'address required';
    }
    if (errMsg) {
        throw ErrorResponse.badRequest(errMsg);
    }
    try {
        const token = await walletService.verifySignature(sign, address);
        const sophToken = await walletService.getSophTokens(address);
        setCookie(c, 'authToken', token, {
            path: '/',
            secure: true,
            httpOnly: true,
            maxAge: 3600,
            sameSite: 'Strict'
        });
        const data = {
            token: token.token,
            userId: token.userId,
            userName: token.userName,
            sophToken
        };
        return SuccessResponse.ok(c, data);
    } catch (error) {
        throw error;
    }
};

/**
 * logOut - Logs out the user by clearing the token.
 * @param {Object} c - The HTTP context object.
 * @returns {Promise<void>} - Returns a promise when the response is sent.
 */
const logOut = async (c) => {
    // Since JWTs are stateless, actual logout happens on the client side
    // by removing the token. This endpoint can be used for auditing or
    // other server-side logout logic if needed.
    return SuccessResponse.ok(c, {}, 'logout successful');
};

/**
 * getSophTokens - Fetches the SOPH token balances.
 * @param {Object} c - The HTTP context object.
 * @returns {Promise<void>} - Returns a promise when the response is sent.
 */
const getSophTokens = async (c) => {
    try {
        const tokenCount = await walletService.getSophTokens();
        return SuccessResponse.ok(c, tokenCount);
    } catch (error) {
        throw error;
    }
};

export { createPayload, verifySignature, logOut, getSophTokens };
