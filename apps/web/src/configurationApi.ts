import type { Configuration } from "./configuration";

export type ConfigurationSummary = { id: string; name: string; visibility: "private" | "unlisted"; created_at: string };
export type SavedConfiguration = ConfigurationSummary & { configuration: Configuration };

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/configurations${path}`, { credentials: "same-origin", ...options });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new Error("Configuration service unavailable. Check the server and try again.");
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(typeof body?.detail === "string" ? body.detail :
      response.status === 422 ? "The configuration is invalid. Check its name and settings." :
      "Could not complete the configuration request. Try again.");
  }
  return response.json();
}

export const listConfigurations = (signal?: AbortSignal) => request<ConfigurationSummary[]>("", { signal });
export const getDefaultConfiguration = (signal?: AbortSignal) => request<SavedConfiguration>("/default", { signal });
export const getConfiguration = (id: string) => request<SavedConfiguration>(`/${encodeURIComponent(id)}`);
export const getSharedConfiguration = (token: string, signal?: AbortSignal) => request<SavedConfiguration>(`/shared/${encodeURIComponent(token)}`, { signal });
export const publishConfiguration = (id: string) => request<{ token: string }>(`/${encodeURIComponent(id)}/share`, { method: "POST" });
export const saveConfiguration = (name: string, configuration: Configuration) => request<SavedConfiguration>("", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, configuration }),
});
