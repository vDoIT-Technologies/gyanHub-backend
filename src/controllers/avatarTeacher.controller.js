import { AvatarTeacherService } from '../services/AvatarTeacherService.js';
import { SuccessResponse } from '../lib/success.res.js';
import { ErrorResponse } from '../lib/error.res.js';
import axios from 'axios';
import { ENV } from '../configs/constant.js';
import FormData from 'form-data';

const service = new AvatarTeacherService();

const parseTopics = (topicsRaw) => {
    if (!topicsRaw) return [];
    if (Array.isArray(topicsRaw)) return topicsRaw;
    try { return JSON.parse(topicsRaw); } catch { return topicsRaw.split(',').map(t => t.trim()).filter(Boolean); }
};

const parseOptionalBoolean = (value) => {
    if (value === null || value === undefined) return undefined;
    if (typeof value === 'boolean') return value;
    return String(value).toLowerCase() === 'true';
};

/**
 * Helper to upload files to persona service and get a personalityId
 * @param {Object} data - Metadata for the persona (name, description, etc)
 * @param {Array} files - Array of Hono file objects
 */
async function syncTeacherToPersona(data, files) {
    const formData = new FormData();
    formData.append('name', data.name);
    if (data.description) formData.append('description', data.description);
    if (data.category) formData.append('category', data.category);
    // Add ElevenLabs voice as brainId
    if (data.voiceId) formData.append('brainId', data.voiceId);

    // If we have an existing personalityId, we're editing
    const endpoint = data.personalityId 
        ? `${ENV.BASE_URL}/personality/edit/${data.personalityId}`
        : `${ENV.BASE_URL}/personality/createPersonality`;
    const method = data.personalityId ? 'put' : 'post';

    if (files && files.length > 0) {
        for (const fileItem of files) {
            const buffer = await fileItem.arrayBuffer();
            formData.append('file', Buffer.from(buffer), {
                filename: fileItem.name,
                contentType: fileItem.type
            });
        }
    }

    const { data: response } = await axios({
        method,
        url: endpoint,
        data: formData,
        headers: {
            'persona-api-key': ENV.PERSONA_API_KEY,
            ...formData.getHeaders()
        }
    });

    if (!response || !response.success) {
        throw ErrorResponse.internalServerError('Failed to sync knowledge to persona service');
    }

    return response.data; // Should contain personalityId and possibly file info
}

export const createAvatarTeacher = async (c) => {
    try {
        const formData = await c.req.formData();
        const files = formData.getAll('file');
        const name = formData.get('name');
        const description = formData.get('description');
        const category = formData.get('category');
        const presenterId = formData.get('presenterId');
        const sourceUrl = formData.get('sourceUrl');
        const voiceId = formData.get('voiceId');
        const imageUrl = formData.get('imageUrl');
        const sysPrompt = formData.get('systemPrompt');
        const knowledgeText = formData.get('knowledgeText');
        const svc = formData.get('service');
        const topicsRaw = formData.get('topics');
        const points = formData.get('points');
        const isActive = parseOptionalBoolean(formData.get('isActive'));
        const isVisible = parseOptionalBoolean(formData.get('isVisible'));

        if (!name) throw ErrorResponse.badRequest('Name is required');

        let personalityId = null;
        let knowledgeFiles = null;

        // If files are present, sync to persona service first
        if (files && files.length > 0) {
            const personaData = await syncTeacherToPersona({ name, description, category, voiceId }, files);
            personalityId = personaData.id || personaData.personalityId;
            knowledgeFiles = personaData.files || null;
        }

        const teacher = await service.create({
            name,
            description: description || null,
            category: category || null,
            imageUrl: imageUrl || null,
            personalityId,
            knowledgeFiles,
            knowledgeText: knowledgeText || null,
            presenterId: presenterId || null,
            sourceUrl: sourceUrl || null,
            service: svc || 'clips',
            voiceId: voiceId || null,
            systemPrompt: sysPrompt || null,
            topics: parseTopics(topicsRaw),
            points: Number(points) || 0,
            ...(isActive !== undefined ? { isActive } : {}),
            ...(isVisible !== undefined ? { isVisible } : {}),
        });

        return SuccessResponse.ok(c, teacher, 'Avatar teacher created successfully');
    } catch (error) { throw error; }
};

export const getAllAvatarTeachers = async (c) => {
    try {
        const teachers = await service.getAll();
        return SuccessResponse.ok(c, teachers, 'Avatar teachers fetched successfully');
    } catch (error) { throw error; }
};

export const getAvatarTeacherById = async (c) => {
    try {
        const id = c.req.param('id');
        const teacher = await service.getById(id);
        return SuccessResponse.ok(c, teacher, 'Avatar teacher fetched successfully');
    } catch (error) { throw error; }
};

export const updateAvatarTeacher = async (c) => {
    try {
        const id = c.req.param('id');
        const formData = await c.req.formData();
        const files = formData.getAll('file');
        
        const existing = await service.getById(id);
        const updateData = {};

        const fields = ['name', 'description', 'category', 'imageUrl', 'presenterId', 'sourceUrl', 'service', 'voiceId', 'systemPrompt', 'knowledgeText', 'points', 'isActive', 'isVisible'];
        fields.forEach(f => {
            const val = formData.get(f);
            if (val !== null) {
                if (f === 'isActive' || f === 'isVisible') {
                    updateData[f] = val === 'true';
                } else if (f === 'points') {
                    updateData[f] = Number(val);
                } else {
                    updateData[f] = val;
                }
            }
        });

        const topicsRaw = formData.get('topics');
        if (topicsRaw !== null) updateData.topics = parseTopics(topicsRaw);

        // Handle knowledge base sync if new files provided
        if (files && files.length > 0) {
            const personaData = await syncTeacherToPersona({ 
                name: updateData.name || existing.name, 
                description: updateData.description || existing.description,
                category: updateData.category || existing.category,
                voiceId: updateData.voiceId || existing.voiceId,
                personalityId: existing.personalityId
            }, files);
            
            updateData.personalityId = personaData.id || personaData.personalityId;
            updateData.knowledgeFiles = personaData.files || null;
        }

        const updated = await service.update(id, updateData);
        return SuccessResponse.ok(c, updated, 'Avatar teacher updated successfully');
    } catch (error) { throw error; }
};

export const deleteAvatarTeacher = async (c) => {
    try {
        const id = c.req.param('id');
        await service.delete(id);
        return SuccessResponse.ok(c, {}, 'Avatar teacher deleted successfully');
    } catch (error) { throw error; }
};

/** Public — for user panel */
export const getVisibleAvatarTeachers = async (c) => {
    try {
        const teachers = await service.getVisibleTeachers();
        return SuccessResponse.ok(c, teachers, 'Teachers fetched successfully');
    } catch (error) { throw error; }
};

/** Public — for chat initialization */
export const getTeacherConfig = async (c) => {
    try {
        const id = c.req.param('teacherId');
        const config = await service.getTeacherConfig(id);
        return SuccessResponse.ok(c, config, 'Teacher config fetched successfully');
    } catch (error) { throw error; }
};
