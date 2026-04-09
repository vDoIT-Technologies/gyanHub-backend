export class SuccessResponse {
    /**
     * Sends a 200 OK response
     * @param {Object} c - Hono context object
     * @param {Object} [data={}] - Data to be sent in the response
     * @param {string} [message="Success"] - Success message
     */

    static ok(c, data = {}, message = 'data retrieved successfully') {
        return c.json({ success: true, message, data }, 200);
    }

    /**
     * Sends a 201 Created response
     * @param {Object} c - Hono context object
     * @param {Object} [data={}] - Data to be sent in the response
     * @param {string} [message="Resource created successfully"] - Success message
     */
    static created(c, data = {}, message = 'Resource created successfully') {
        return c.json({ success: true, message, data }, 201);
    }

    /**
     * Sends a 202 Accepted response
     * @param {Object} c - Hono context object
     * @param {Object} [data={}] - Data to be sent in the response
     * @param {string} [message="Request accepted"] - Success message
     */
    static accepted(c, data = {}, message = 'Request accepted') {
        return c.json({ success: true, message, data }, 202);
    }

    /**
     * Sends a 204 No Content response
     * @param {Object} c - Hono context object
     * @param {string} [message="No content"] - Success message
     */
    static noContent(c, data = {}, message = 'No content') {
        return c.json({ success: true, message, data }, 204);
    }

    /**
     * Sends a 206 Partial Content response
     * @param {Object} c - Hono context object
     * @param {Object} data - Partial data to be sent in the response
     * @param {string} [message="Partial content"] - Success message
     */
    static partialContent(c, data = {}, message = 'Partial content') {
        return c.json({ success: true, message, data }, 206);
    }
}
