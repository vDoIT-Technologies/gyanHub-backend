import { SuccessResponse } from '../lib/success.res.js';
import { ingestDocumentFromFile } from '../services/documentService.js';

/**
 * uploadDocument - Handles POST request for document ingestion.
 * Extracts file, teacherId, and title from formData and ownerId from context.
 */
export const uploadDocument = async (c) => {
    try {
        const formData = await c.req.formData();
        const file = formData.get('file'); // File object
        const teacherId = formData.get('teacherId') || formData.get('teacher_id'); // Support both camel and snake case
        const title = formData.get('title'); 
        const generateEmbeddings = formData.get('generateEmbeddings'); // String "true"/"false"

        // Retrieve the logged-in user's ID from the context (set by auth middleware)
        const user = c.get('user'); 
        const ownerId = user?.userId || user?.id || null; // Check both userId (User) and id (Admin)

        const result = await ingestDocumentFromFile({
            file,
            ownerId,
            teacherId,
            title,
            generateEmbeddings
        });

        return SuccessResponse.ok(c, result, 'Document uploaded and processed successfully');
    } catch (error) {
        throw error;
    }
};