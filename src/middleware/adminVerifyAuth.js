import jwt from 'jsonwebtoken';
import { ENV } from '../configs/constant.js';
import { SuccessResponse } from '../lib/success.res.js';
import { ErrorResponse } from '../lib/error.res.js';

const adminVerifyAuth = async (c, next) => {
    let token;

    const authHeader = c.req.header('Authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.split(' ')[1];
    }

    if (!token) {
        throw ErrorResponse.unauthorized('No token provided');
    }

    try {
        const payload = jwt.verify(token, ENV.JWT_SECRET);

        c.set('admin', { adminId: payload.id });

        await next();
    } catch (error) {
        throw ErrorResponse.unauthorized('Invalid token');
    }
};

export default adminVerifyAuth;