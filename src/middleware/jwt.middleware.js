import { verify } from 'jsonwebtoken';
import { ENV } from '../configs/constant.js';
import { ErrorResponse } from '../lib/error.res.js';

const jwtAuthMiddleware = async (c, next) => {
    let token;

    const authHeader = c.req.header('Authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.split(' ')[1];
    }

    // if (!token) {
    //     token = c.req.cookie('authToken');
    // }

    if (!token) {
        throw ErrorResponse.unauthorized('No token provided');
    }

    try {
        const payload = verify(token, ENV.JWT_SECRET);

        const { userId, address } = payload;

        c.set('user', { userId, address });

        await next();
    } catch (error) {
        return ErrorResponse.unauthorized('Invalid token');
    }
};

export default jwtAuthMiddleware;
