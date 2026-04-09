import { ErrorResponse } from '../lib/error.res.js';
import prisma from '../lib/prisma.js';

export class AvatarTeacherService {

    async create(data) {
        const teacher = await prisma.avatarTeacher.create({ data });
        return teacher;
    }

    async getAll() {
        return prisma.avatarTeacher.findMany({ orderBy: { createdAt: 'desc' } });
    }

    async getById(id) {
        const teacher = await prisma.avatarTeacher.findUnique({ where: { id } });
        if (!teacher) throw ErrorResponse.notFound('Avatar teacher not found');
        return teacher;
    }

    async update(id, data) {
        const exists = await prisma.avatarTeacher.findUnique({ where: { id } });
        if (!exists) throw ErrorResponse.notFound('Avatar teacher not found');
        return prisma.avatarTeacher.update({ where: { id }, data });
    }

    async delete(id) {
        const exists = await prisma.avatarTeacher.findUnique({ where: { id } });
        if (!exists) throw ErrorResponse.notFound('Avatar teacher not found');
        await prisma.avatarTeacher.delete({ where: { id } });
        return true;
    }

    /** Returns all teachers that are visible to the user panel */
    async getVisibleTeachers() {
        return prisma.avatarTeacher.findMany({
            where: { isVisible: true },
            select: {
                id: true,
                name: true,
                description: true,
                imageUrl: true,
                points: true,
                isActive: true,
                topics: true
            },
            orderBy: { createdAt: 'asc' }
        });
    }

    /** Returns full config for a specific teacher (used by chat) */
    async getTeacherConfig(id) {
        const teacher = await prisma.avatarTeacher.findUnique({ where: { id } });
        if (!teacher) throw ErrorResponse.notFound('Avatar teacher not found');
        if (!teacher.isActive) throw ErrorResponse.badRequest('This teacher is currently inactive');
        return teacher;
    }
}
