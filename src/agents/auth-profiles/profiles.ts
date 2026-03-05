import { normalizeSecretInput } from "../../utils/normalize-secret-input.js";
import { normalizeProviderId } from "../model-selection.js";
import {
  ensureAuthProfileStore,
  saveAuthProfileStore,
  updateAuthProfileStoreWithLock,
} from "./store.js";
import type { AuthProfileCredential, AuthProfileStore, ProfileUsageStats } from "./types.js";

export function dedupeProfileIds(profileIds: string[]): string[] {
  return [...new Set(profileIds)];
}

const MANUAL_DISABLE_UNTIL_MS = Date.UTC(2100, 0, 1);

function findProviderOrderKeys(order: Record<string, string[]>, provider: string): string[] {
  const providerKey = normalizeProviderId(provider);
  return Object.keys(order).filter((key) => normalizeProviderId(key) === providerKey);
}

function arraysEqual(left: string[] | undefined, right: string[]): boolean {
  if (!left) {
    return right.length === 0;
  }
  if (left.length !== right.length) {
    return false;
  }
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) {
      return false;
    }
  }
  return true;
}

export async function setAuthProfileOrder(params: {
  agentDir?: string;
  provider: string;
  order?: string[] | null;
}): Promise<AuthProfileStore | null> {
  const providerKey = normalizeProviderId(params.provider);
  const sanitized =
    params.order && Array.isArray(params.order)
      ? params.order.map((entry) => String(entry).trim()).filter(Boolean)
      : [];
  const deduped = dedupeProfileIds(sanitized);

  return await updateAuthProfileStoreWithLock({
    agentDir: params.agentDir,
    updater: (store) => {
      store.order = store.order ?? {};
      const matchingKeys = findProviderOrderKeys(store.order, providerKey);
      if (deduped.length === 0) {
        if (matchingKeys.length === 0) {
          return false;
        }
        for (const key of matchingKeys) {
          delete store.order[key];
        }
        if (Object.keys(store.order).length === 0) {
          store.order = undefined;
        }
        return true;
      }

      const existing = matchingKeys[0] ? store.order[matchingKeys[0]] : undefined;
      const alreadyCanonical =
        matchingKeys.length === 1 && matchingKeys[0] === providerKey && arraysEqual(existing, deduped);
      if (alreadyCanonical) {
        return false;
      }

      for (const key of matchingKeys) {
        delete store.order[key];
      }
      store.order[providerKey] = deduped;
      return true;
    },
  });
}

export async function setAuthProfileManualDisabled(params: {
  agentDir?: string;
  profileId: string;
  disabled: boolean;
}): Promise<AuthProfileStore | null> {
  return await updateAuthProfileStoreWithLock({
    agentDir: params.agentDir,
    updater: (store) => {
      if (!store.profiles[params.profileId]) {
        return false;
      }
      const stats = (store.usageStats?.[params.profileId] ?? {}) as ProfileUsageStats;
      const hasManualDisable =
        stats.disabledReason === "manual" &&
        typeof stats.disabledUntil === "number" &&
        Number.isFinite(stats.disabledUntil) &&
        stats.disabledUntil > Date.now();
      if (params.disabled) {
        if (hasManualDisable) {
          return false;
        }
        store.usageStats = store.usageStats ?? {};
        store.usageStats[params.profileId] = {
          ...stats,
          cooldownUntil: undefined,
          disabledUntil: MANUAL_DISABLE_UNTIL_MS,
          disabledReason: "manual",
        };
        return true;
      }
      if (!hasManualDisable) {
        return false;
      }
      store.usageStats = store.usageStats ?? {};
      store.usageStats[params.profileId] = {
        ...stats,
        disabledUntil: undefined,
        disabledReason: undefined,
      };
      return true;
    },
  });
}

export async function deleteAuthProfile(params: {
  agentDir?: string;
  profileId: string;
}): Promise<AuthProfileStore | null> {
  return await updateAuthProfileStoreWithLock({
    agentDir: params.agentDir,
    updater: (store) => {
      if (!store.profiles[params.profileId]) {
        return false;
      }

      delete store.profiles[params.profileId];

      if (store.order) {
        for (const [provider, order] of Object.entries(store.order)) {
          const next = order.filter((id) => id !== params.profileId);
          if (next.length > 0) {
            store.order[provider] = next;
          } else {
            delete store.order[provider];
          }
        }
        if (Object.keys(store.order).length === 0) {
          store.order = undefined;
        }
      }

      if (store.lastGood) {
        for (const [provider, profileId] of Object.entries(store.lastGood)) {
          if (profileId === params.profileId) {
            delete store.lastGood[provider];
          }
        }
        if (Object.keys(store.lastGood).length === 0) {
          store.lastGood = undefined;
        }
      }

      if (store.usageStats) {
        delete store.usageStats[params.profileId];
        if (Object.keys(store.usageStats).length === 0) {
          store.usageStats = undefined;
        }
      }

      return true;
    },
  });
}

export function upsertAuthProfile(params: {
  profileId: string;
  credential: AuthProfileCredential;
  agentDir?: string;
}): void {
  const credential =
    params.credential.type === "api_key"
      ? {
          ...params.credential,
          ...(typeof params.credential.key === "string"
            ? { key: normalizeSecretInput(params.credential.key) }
            : {}),
        }
      : params.credential.type === "token"
        ? { ...params.credential, token: normalizeSecretInput(params.credential.token) }
        : params.credential;
  const store = ensureAuthProfileStore(params.agentDir);
  store.profiles[params.profileId] = credential;
  saveAuthProfileStore(store, params.agentDir);
}

export async function upsertAuthProfileWithLock(params: {
  profileId: string;
  credential: AuthProfileCredential;
  agentDir?: string;
}): Promise<AuthProfileStore | null> {
  return await updateAuthProfileStoreWithLock({
    agentDir: params.agentDir,
    updater: (store) => {
      store.profiles[params.profileId] = params.credential;
      return true;
    },
  });
}

export function listProfilesForProvider(store: AuthProfileStore, provider: string): string[] {
  const providerKey = normalizeProviderId(provider);
  return Object.entries(store.profiles)
    .filter(([, cred]) => normalizeProviderId(cred.provider) === providerKey)
    .map(([id]) => id);
}

export async function markAuthProfileGood(params: {
  store: AuthProfileStore;
  provider: string;
  profileId: string;
  agentDir?: string;
}): Promise<void> {
  const { store, provider, profileId, agentDir } = params;
  const updated = await updateAuthProfileStoreWithLock({
    agentDir,
    updater: (freshStore) => {
      const profile = freshStore.profiles[profileId];
      if (!profile || profile.provider !== provider) {
        return false;
      }
      freshStore.lastGood = { ...freshStore.lastGood, [provider]: profileId };
      return true;
    },
  });
  if (updated) {
    store.lastGood = updated.lastGood;
    return;
  }
  const profile = store.profiles[profileId];
  if (!profile || profile.provider !== provider) {
    return;
  }
  store.lastGood = { ...store.lastGood, [provider]: profileId };
  saveAuthProfileStore(store, agentDir);
}
