const errorHandler = async (error, c) => {
    const statusCode = error.status || 500;
    const message = error.message || 'Internal Server Error';
    const response = {
        success: false,
        message: message,
        data: {}
    };
    return c.json(response, statusCode);
};

export default errorHandler;
