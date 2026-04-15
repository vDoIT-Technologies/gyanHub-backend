import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { serveStatic } from 'hono/bun';
import { prettyJSON } from 'hono/pretty-json';
import { trimTrailingSlash } from 'hono/trailing-slash';
import errorHandler from './middleware/errorHandler.js';
import { cors } from 'hono/cors';
import { ENV } from './configs/constant.js';

import chatApi from './routes/chat.js';
import authApi from './routes/wallet.js';
import userApi from './routes/user.js';
import adminApi from './routes/admin.js';
import userAuthApi from './routes/auth.js';
import courseRoutes from './routes/course.js';
import testRoutes from './routes/test.js';
import documentRoutes from './routes/documents.js';
const app = new Hono().basePath('/api/v1');

global.revokedTokens = new Set();
app.use('*', cors({
    origin: (origin) => origin, // Dynamically allows the requesting origin to support credentials
    credentials: true,
    allowHeaders: ['Content-Type', 'Authorization', 'Accept', 'X-Requested-With'],
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
}));

app.use(logger());
app.use(prettyJSON());
app.use(trimTrailingSlash());

app.use('*', async (c, next) => {
    try {
        await next();
        c.header('X-Powered-By', 'Sentience');
        c.header('X-SENTIENCE-ENV', ENV.NODE_ENV || 'development');
    } catch (err) {
        // Re-throw the error so app.onError(errorHandler) can handle it properly
        // with the appropriate context and headers.
        throw err;
    }
});

// Serve static files from the public directory
app.use('/uploads/*', (c, next) => {
    const staticPath = c.req.path.replace('/api/v1', '');
    return serveStatic({ root: './public', path: staticPath })(c, next);
});

app.route('/user', userApi);
app.route('/chat', chatApi);
app.route('/auth', authApi);
app.route('/admin', adminApi);
app.route('/userauth', userAuthApi);
app.route("/courses", courseRoutes);
app.route("/tests", testRoutes);
app.route("/documents", documentRoutes);
app.onError(errorHandler);


const port = ENV.PORT || 3009;
if (ENV.NODE_ENV == 'development') {
    console.log(`Server is running on port ${port}`);
}

export default {
    fetch: app.fetch,
    port,
    hostname: '0.0.0.0'
};
