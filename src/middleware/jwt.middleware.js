import jwt from 'jsonwebtoken';
import { ENV } from '../configs/constant.js';
import { ErrorResponse } from '../lib/error.res.js';

const jwtAuthMiddleware = async (c, next) => {
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

        const { userId, address } = payload;

        c.set('user', { userId, address });

        await next();
    } catch (error) {
        return ErrorResponse.unauthorized('Invalid token');
    }
};

export default jwtAuthMiddleware;