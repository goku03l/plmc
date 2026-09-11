const BASE = "/api";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const isForm = typeof FormData !== "undefined" && init?.body instanceof FormData;
  const res = await fetch(BASE + path, {
    ...init,
    // Only send a JSON content-type when there's actually a JSON body — Fastify
    // rejects an empty body when content-type is application/json (breaks every
    // DELETE), and FormData must set its own multipart boundary.
    headers: {
      ...(init?.body != null && !isForm ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      msg = body.error ?? msg;
      if (body.issues) msg += ": " + body.issues.map((i: { message: string }) => i.message).join(", ");
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(p: string) => req<T>(p),
  post: <T>(p: string, body?: unknown) => req<T>(p, { method: "POST", body: JSON.stringify(body ?? {}) }),
  patch: <T>(p: string, body?: unknown) => req<T>(p, { method: "PATCH", body: JSON.stringify(body ?? {}) }),
  del: (p: string) => req<void>(p, { method: "DELETE" }),
  upload: <T>(p: string, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return req<T>(p, { method: "POST", body: fd });
  },
};
