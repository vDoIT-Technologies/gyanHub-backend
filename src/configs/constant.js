import dotenv from 'dotenv';
dotenv.config();

const ENV = {
    DATABASE_URL: process.env.DATABASE_URL,
    DB_PORT: process.env.DB_PORT,
    BASE_URL: process.env.BASE_URL,
    AWS_ACCESS_KEY: process.env.AWS_ACCESS_KEY,
    AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
    AWS_REGION: process.env.AWS_REGION,
    AWS_SENDER: process.env.AWS_SENDER,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY,
    PERSONA_API_KEY: process.env.PERSONA_API_KEY,
    PRIVATE_KEYVI: process.env.PRIVATE_KEYVI,
    PRIVATE_KEY_SECRET_KEY: process.env.PRIVATE_KEY_SECRET_KEY,
    JWT_SECRET: process.env.JWT_SECRET,
    CONTRACT_ADDRESS: process.env.CONTRACT_ADDRESS,
    ETH_PROVIDER: process.env.ETH_PROVIDER,
    BINANCE_PROVIDER: process.env.BINANCE_PROVIDER,
    NODE_ENV: process.env.NODE_ENV,
    WEBSOCKET_URL_BEN_SNET: process.env.WEBSOCKET_URL_BEN_SNET,
    BEN_SNET_ID: process.env.BEN_SNET_ID,
    ELEVEN_LABS_API_URL: process.env.ELEVEN_LABS_API_URL
};

export { ENV };
