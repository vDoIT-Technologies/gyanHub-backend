export class ErrorResponse extends Error {
    constructor(message, statusCode) {
        super(message);
        this.status = statusCode;
    }

    /**
     * Sends a 400 Bad Request response
     * @param {string} [message="Bad request"] - Error message
     */
    static badRequest(message = 'Bad request') {
        return new ErrorResponse(message, 400);
    }

    /**
     * Sends a 401 Unauthorized response
     * @param {string} [message="Unauthorized"] - Error message
     */
    static unauthorized(message = 'Unauthorized') {
        return new ErrorResponse(message, 401);
    }

    /**
     * Sends a 403 Forbidden response
     * @param {string} [message="Forbidden"] - Error message
     */
    static forbidden(message = 'Forbidden') {
        return new ErrorResponse(message, 403);
    }

    /**
     * Sends a 404 Not Found response
     * @param {string} [message="Resource not found"] - Error message
     */
    static notFound(message = 'Resource not found') {
        return new ErrorResponse(message, 404);
    }

    /**
     * Sends a 409 Conflict response
     * @param {string} [message="Conflict"] - Error message
     */
    static conflict(message = 'Conflict') {
        return new ErrorResponse(message, 409);
    }

    /**
     * Sends a 422 Unprocessable Entity response
     * @param {string} [message="Unprocessable entity"] - Error message
     */
    static unprocessableEntity(message = 'Unprocessable entity') {
        return new ErrorResponse(message, 422);
    }

    /**
     * Sends a 429 Too Many Requests response
     * @param {string} [message="Too many requests"] - Error message
     */
    static tooManyRequests(message = 'Too many requests') {
        return new ErrorResponse(message, 429);
    }

    /**
     * Sends a 500 Internal Server Error response
     * @param {string} [message="Internal server error"] - Error message
     */
    static internalServerError(message = 'Internal server error') {
        return new ErrorResponse(message, 500);
    }

    /**
     * Sends a 503 Service Unavailable response
     * @param {string} [message="Service unavailable"] - Error message
     */
    static serviceUnavailable(message = 'Service unavailable') {
        return new ErrorResponse(message, 503);
    }
}
