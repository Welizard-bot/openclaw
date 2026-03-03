import type { ModelCatalogEntry } from "./types.ts";

export function modelCatalogEntryRef(entry: Pick<ModelCatalogEntry, "provider" | "id">): string {
  const provider = entry.provider.trim();
  const id = entry.id.trim();
  return provider && id ? `${provider}/${id}` : id;
}

export function resolveModelRef(provider?: string | null, model?: string | null): string {
  const normalizedModel = typeof model === "string" ? model.trim() : "";
  if (!normalizedModel) {
    return "";
  }
  if (normalizedModel.includes("/")) {
    return normalizedModel;
  }
  const normalizedProvider = typeof provider === "string" ? provider.trim() : "";
  return normalizedProvider ? `${normalizedProvider}/${normalizedModel}` : normalizedModel;
}
