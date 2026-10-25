export const API_ROOT = (import.meta.env.VITE_API_URL || 'http://localhost:8000').replace(/\/$/, '');
const BASE = `${API_ROOT}/api`;

export class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function formatDetail(detail) {
  if (!detail) return '';
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((e) => {
        const field = (e.loc || []).filter((p) => p !== 'body').join('.');
        return `${field ? `${field}: ` : ''}${(e.msg || '').replace(/^Value error, /, '')}`;
      })
      .join('; ');
  }
  return JSON.stringify(detail);
}

async function request(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(BASE + path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(`Cannot reach the API at ${API_ROOT}. Is the backend running?`, 0);
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(formatDetail(data?.detail) || `Request failed (${res.status})`, res.status, data?.code);
  }
  return data;
}

export const api = {
  health: () => request('/health'),
  listCourses: () => request('/courses'),
  createCourse: (body) => request('/courses', { method: 'POST', body }),
  updateCourse: (id, body) => request(`/courses/${id}`, { method: 'PATCH', body }),
  deleteCourse: (id, cascade = false) => request(`/courses/${id}?cascade=${cascade}`, { method: 'DELETE' }),
  listPrereqs: () => request('/prerequisites'),
  createPrereq: (body) => request('/prerequisites', { method: 'POST', body }),
  updatePrereq: (id, body) => request(`/prerequisites/${id}`, { method: 'PUT', body }),
  deletePrereq: (id) => request(`/prerequisites/${id}`, { method: 'DELETE' }),
  graph: () => request('/graph'),
  analysis: () => request('/analysis'),
  analyzeCustom: (body) => request('/analysis/custom', { method: 'POST', body }),
  sampleLoad: () => request('/sample/load', { method: 'POST' }),
  sampleReset: () => request('/sample/reset', { method: 'POST' }),
  sampleRemove: () => request('/sample', { method: 'DELETE' }),
};
