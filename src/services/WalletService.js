import { PrismaClient } from '@prisma/client';
import { ethers } from 'ethers';
import jwt from 'jsonwebtoken';
import { UserService } from './UserService';
import { abi } from '../utils/contract';
import { ErrorResponse } from '../lib/error.res.js';
import { ENV } from '../configs/constant.js';
import crypto from 'crypto';

const prisma = new PrismaClient();

const userService = new UserService();

const localDB = new Map();
export class WalletService {
    constructor() {
        this.jwtSecret = ENV.JWT_SECRET;
    }

    /**
     * createPayload - Generates a payload for wallet signature.
     * @param {Object} req - The HTTP request object.
     * @param {string} address - Wallet address.
     * @returns {Promise<string>} - The generated payload.
     */
    async createPayload(req, address) {
        const payload = await this.generatePayload(req, address);
        address.toLowerCase();

        localDB.set(address, payload);
        const existingWallet = await prisma.wallet.findUnique({
            where: { address }
        });

        if (!existingWallet) {
            await this.createNewWallet(address, payload);
        }
        return payload;
    }

    /**
     * verifySignature - Verifies the wallet signature.
     * @param {string} sign - The signature.
     * @param {string} address - Wallet address.
     * @returns {Promise<Object>} - Token and user details.
     */
    async verifySignature(sign, address) {
        address.toLowerCase();
        
        const wallet = await prisma.wallet.findUnique({ where: { address } });
        if (!wallet) {
            throw ErrorResponse.notFound('Wallet not found');
        }

        const message = localDB.get(address);
        if (!message) {
            throw ErrorResponse.notFound('No payload found for this wallet');
        }
        const recoveredAddress = ethers.utils.verifyMessage(message, sign).toLowerCase();

        if (recoveredAddress === address) {
            let user = await prisma.user.findUnique({
                where: { walletId: wallet.id }
            });

            if (!user) {
                user = await userService.createUserForExistingWallet(wallet);
            }
            const token = await this.generateToken(address, user.id);
            const userId = user.id;
            const userName = user.name;
            return { token, userId, userName };
        } else {
            throw ErrorResponse.unauthorized('Signature verification failed');
        }
    }

    /**
     * generatePayload - Generates a message payload for signature verification.
     * @param {Object} req - The HTTP request object.
     * @param {string} address - Wallet address.
     * @returns {string} - The generated message.
     */
    async generatePayload(req, address) {
        const date = new Date();
        const domain = req.header('Origin');
        const nonce = Math.floor(Math.random() * 1000000);

        return `${domain} wants you to sign in with your Ethereum account:\n${address}\n\nI accept the Sentience Terms of Service: https://community.sentience.io/tos\n\nURI: https://${domain}\nVersion: 1\nChain ID: 1\nNonce: ${nonce}\nIssued At: ${date}`;
    }

    /**
     * Updates an existing wallet with new metadata.
     * @param {Object} wallet - The wallet object.
     * @param {string} payload - The new payload.
     * @returns {Promise<void>}
     */
    async updateExistingWallet(wallet, payload) {
        await prisma.wallet.update({
            where: { id: wallet.id },
            data: {
                metadata: {
                    payload: payload
                }
            }
        });
    }

    /**
     * Creates a new wallet entry in the database.
     * @param {string} address - The wallet address.
     * @param {string} payload - The payload for the wallet.
     * @returns {Promise<void>}
     */
    async createNewWallet(address, payload) {
        await prisma.wallet.create({
            data: {
                address,
                metadata: {
                    payload: payload
                }
            }
        });
    }

    /**
     * Generates a JWT token for the user.
     * @param {string} address - The wallet address.
     * @param {number} userId - The user ID.
     * @returns {Promise<string>} - The generated JWT token.
     */
    async generateToken(address, userId) {
        const token = jwt.sign({ address, userId }, this.jwtSecret, {
            expiresIn: '1h'
        });
        return token;
    }

    /**
     * Retrieves SOPH token balances for a wallet address.
     * @param {string} address - The wallet address.
     * @returns {Promise<Object>} - An object containing ETH and BNB token balances.
     */
    async getSophTokens(address) {
        let account = address;
        let provider = new ethers.providers.JsonRpcProvider(`${ENV.ETH_PROVIDER}`);
        let balance = null;
        let eth_contract = new ethers.Contract(`${ENV.CONTRACT_ADDRESS}`, abi, provider);
        balance = await eth_contract.balanceOf(account);
        const bncprovider = new ethers.providers.JsonRpcProvider(`${ENV.BINANCE_PROVIDER}`);
        let bnc_contract = new ethers.Contract(`${ENV.CONTRACT_ADDRESS}`, abi, bncprovider);
        let bnc_balance = await bnc_contract.balanceOf(account);
        return {
            ethTokens: ethers.utils.formatEther(balance),
            bncTokens: ethers.utils.formatEther(bnc_balance)
        };
    }

    /**
     * Generates a new wallet using a hashed email.
     * @param {string} email - The user's email address.
     * @returns {Promise<Object>} - The generated wallet.
     */
    async generateWallet(email) {
        const key1 = ENV.PRIVATE_KEYVI;
        const key2 = ENV.PRIVATE_KEY_SECRET_KEY;

        if (!key1 || !key2) {
            throw ErrorResponse.internalServerError('Environment variables are missing');
        }

        const emailHash = crypto.createHash('sha256').update(email).digest('hex');

        const entropy = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(emailHash + key1 + key2));

        const mnemonic = ethers.utils.entropyToMnemonic(ethers.utils.arrayify(entropy));

        const userWallet = ethers.Wallet.fromMnemonic(mnemonic);
        return {
            data: userWallet
        };
    }

    async close() {
        await prisma.$disconnect();
    }
}
