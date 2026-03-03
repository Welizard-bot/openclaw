import type { GatewayBrowserClient } from "../gateway.ts";
import type { ModelCatalogEntry } from "../types.ts";

export type ModelCatalogState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  availableModelsLoading: boolean;
  availableModels: ModelCatalogEntry[];
};

export async function loadAvailableModels(state: ModelCatalogState) {
  if (!state.client || !state.connected || state.availableModelsLoading) {
    return;
  }
  state.availableModelsLoading = true;
  try {
    const res = await state.client.request<{ models?: ModelCatalogEntry[] }>("models.list", {});
    state.availableModels = Array.isArray(res?.models) ? res.models : [];
  } catch {
    state.availableModels = [];
  } finally {
    state.availableModelsLoading = false;
  }
}
