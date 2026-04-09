import { WebSocketServer } from 'ws';
import http from 'http';
import { WebsocketsChat } from './websockets/chat';
import { ENV } from '../src/configs/constant.js';

const server = http.createServer();
const wss = new WebSocketServer({ server });

WebsocketsChat(wss);

const PORT = ENV.WS_PORT || 3010;
server.listen(PORT, () => {
    if (ENV.NODE_ENV == 'development') {
        console.log(`WebSocket server is running on ws://localhost:${PORT}`);
    }
});
