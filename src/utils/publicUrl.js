import { ENV } from '../configs/constant.js';

function stripTrailingSlash(value) {
    return String(value || '').replace(/\/+$/, '');
}

function getApiBaseUrl() {
    const explicitPublic = stripTrailingSlash(ENV.PUBLIC_BASE_URL);
    if (explicitPublic) return explicitPublic;

    const baseUrl = stripTrailingSlash(ENV.BASE_URL);
    const isLocalBase = /^https?:\/\/(?:localhost|127\.0\.0\.1):\d+(?:\/.*)?$/i.test(baseUrl);

    if (baseUrl && !isLocalBase) return baseUrl;

    const renderExternal = stripTrailingSlash(ENV.RENDER_EXTERNAL_URL);
    if (renderExternal) return `${renderExternal}/api/v1`;

    return baseUrl;
}

function toUploadsPath(url) {
    const raw = String(url || '').trim();
    if (!raw) return raw;

    if (raw.startsWith('/uploads/')) return `/api/v1${raw}`;
    if (raw.startsWith('/api/v1/uploads/')) return raw;

    const localhostMatch = raw.match(/^https?:\/\/(?:localhost|127\.0\.0\.1):\d+(\/api\/v1\/uploads\/.+)$/i);
    if (localhostMatch) return localhostMatch[1];

    return null;
}

export function normalizePublicUploadUrl(url) {
    const uploadsPath = toUploadsPath(url);
    if (!uploadsPath) return String(url || '').trim();

    const apiBase = getApiBaseUrl();
    if (!apiBase) return uploadsPath;

    const base = stripTrailingSlash(apiBase);
    if (base.endsWith('/api/v1') && uploadsPath.startsWith('/api/v1/')) {
        return `${base}${uploadsPath.slice('/api/v1'.length)}`;
    }
    return `${base}${uploadsPath}`;
}

export function normalizeUploadsInText(text) {
    const value = String(text || '');
    const normalizedLocalhostUrls = value.replace(
        /https?:\/\/(?:localhost|127\.0\.0\.1):\d+(\/(?:api\/v1\/)?uploads\/[^\s)"]+)/gi,
        (_, path) => normalizePublicUploadUrl(path)
    );

    return normalizedLocalhostUrls.replace(
        /(^|[\s("(])((?:\/(?:api\/v1\/)?uploads\/[^\s)"]+))/gi,
        (_, prefix, path) => `${prefix}${normalizePublicUploadUrl(path)}`
    );
}
