import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import { ErrorResponse } from '../lib/error.res.js';
import { ENV } from '../configs/constant.js';

const prisma = new PrismaClient();

export class UserService {
    constructor() {}
    /**
     * createUserForExistingWallet - Creates an user for an existing wallet.
     * @param {Object} wallet - Wallet details.
     * @returns {Promise<Object>} - The created user.
     */
    async createUserForExistingWallet(wallet) {
        const { data: response } = await axios.post(
            `${ENV.BASE_URL}/user/create`,
            {},
            {
                headers: {
                    'persona-api-key': ENV.PERSONA_API_KEY
                }
            }
        );
        if (!response) {
            throw ErrorResponse.internalServerError('Failed to get response from the persona');
        }

        return prisma.user.create({
            data: {
                id: response.data.id,
                name: `User ${wallet.address.slice(0, 6)}`,
                walletId: wallet.id
            }
        });
    }

    /**
     * getUserById - Retrieves a user by ID.
     * @param {string} userId - The user ID.
     * @returns {Promise<Object>} - The user details.
     */
    async getUserById(userId) {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                name: true,
                email: true,
                wallet: {
                    select: {
                        address: true
                    }
                },
                profilePhoto: true,
                createdAt: true
            }
        });
        if (!user) {
            throw ErrorResponse.notFound('User not found');
        }
        return {
            id: user.id,
            name: user.name,
            email: user.email,
            walletAddress: user.wallet.address,
            profilePhoto: user.profilePhoto || '',
            joinedOn: user.createdAt,
            sophToken: '10k'
        };
    }

    /**
     * updateUser - Updates user details.
     * @param {string} userId - The user ID.
     * @param {Object} data - Data to update.
     * @returns {Promise<Object>} - The updated user details.
     */
    async updateUser(userId, data) {
        const updatedUser = await prisma.user.update({
            where: { id: userId },
            data: {
                ...data,
                profilePhoto: data.profilePhoto
            }
        });
        return updatedUser;
    }
}
