import type { GatewayBrowserClient } from "../gateway.ts";
import type { ModelsAuthStatusResult } from "../types.ts";

export type ModelAuthState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  modelAuthLoading: boolean;
  modelAuthBusyKey: string | null;
  modelAuthError: string | null;
  modelAuthStatus: ModelsAuthStatusResult | null;
};

async function runModelAuthAction(
  state: ModelAuthState,
  key: string,
  method: string,
  params: Record<string, unknown>,
) {
  if (!state.client || !state.connected) {
    return;
  }
  if (state.modelAuthBusyKey) {
    return;
  }
  state.modelAuthBusyKey = key;
  state.modelAuthError = null;
  try {
    const result = await state.client.request<ModelsAuthStatusResult>(method, params);
    if (result) {
      state.modelAuthStatus = result;
    }
  } catch (err) {
    state.modelAuthError = String(err);
  } finally {
    state.modelAuthBusyKey = null;
  }
}

export async function loadModelAuthStatus(state: ModelAuthState) {
  if (!state.client || !state.connected) {
    return;
  }
  if (state.modelAuthLoading) {
    return;
  }
  state.modelAuthLoading = true;
  state.modelAuthError = null;
  try {
    const result = await state.client.request<ModelsAuthStatusResult>("models.auth.status", {});
    state.modelAuthStatus = result ?? null;
  } catch (err) {
    state.modelAuthError = String(err);
  } finally {
    state.modelAuthLoading = false;
  }
}

export async function promoteModelAuthProfile(
  state: ModelAuthState,
  provider: string,
  profileId: string,
) {
  await runModelAuthAction(
    state,
    `promote:${provider}:${profileId}`,
    "models.auth.promote",
    { provider, profileId },
  );
}

export async function clearModelAuthOrder(state: ModelAuthState, provider: string) {
  await runModelAuthAction(
    state,
    `clear-order:${provider}`,
    "models.auth.order.clear",
    { provider },
  );
}

export async function clearModelAuthCooldown(state: ModelAuthState, profileId: string) {
  await runModelAuthAction(
    state,
    `clear-cooldown:${profileId}`,
    "models.auth.cooldown.clear",
    { profileId },
  );
}
