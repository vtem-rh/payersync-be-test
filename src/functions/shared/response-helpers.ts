export const getAllowedOrigin = (): string => {
    return process.env.NODE_ENV === 'test'
        ? 'http://localhost:3000'
        : 'https://test.d4tu0pbfxi4ui.amplifyapp.com';
};

export const returnError = (statusCode: number, message: string, error?: any) => {
    // Log the error for debugging (optional - you can remove if not needed)
    if (error) {
        console.error(message, error);
    }

    return {
        statusCode,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': getAllowedOrigin(),
            'Access-Control-Allow-Credentials': 'true',
        },
        body: JSON.stringify({
            message,
            ...(error && process.env.NODE_ENV === 'dev' && { error: error.message })
        }),
    };
};

export const returnSuccess = (statusCode: number, data: any) => {
    return {
        statusCode,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': getAllowedOrigin(),
            'Access-Control-Allow-Credentials': 'true',
        },
        body: JSON.stringify(data),
    };
};

export const getCorsHeaders = () => {
    return {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': getAllowedOrigin(),
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };
};

export const returnOptionsResponse = () => {
    return {
        statusCode: 200,
        headers: getCorsHeaders(),
        body: '',
    };
};