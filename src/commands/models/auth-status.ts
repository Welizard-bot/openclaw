import {
  resolveAgentDir,
  resolveAgentExplicitModelPrimary,
  resolveAgentModelFallbacksOverride,
  resolveDefaultAgentId,
} from "../../agents/agent-scope.js";
import { DEFAULT_PROVIDER } from "../../agents/defaults.js";
import { buildAuthHealthSummary, DEFAULT_OAUTH_WARN_MS } from "../../agents/auth-health.js";
import {
  ensureAuthProfileStore,
  resolveAuthProfileDisplayLabel,
  resolveAuthProfileOrder,
  resolveAuthStorePathForDisplay,
  resolveProfileUnusableUntilForDisplay,
} from "../../agents/auth-profiles.js";
import {
  findNormalizedProviderValue,
  normalizeProviderId,
  parseModelRef,
  resolveDefaultModelForAgent,
} from "../../agents/model-selection.js";
import { resolveEnvApiKey } from "../../agents/model-auth.js";
import { loadConfig } from "../../config/config.js";
import {
  resolveAgentModelFallbackValues,
  resolveAgentModelPrimaryValue,
} from "../../config/model-input.js";
import type { AuthProfileFailureReason, ProfileUsageStats } from "../../agents/auth-profiles.js";
import type { OpenClawConfig } from "../../config/config.js";
import { resolveProviderAuthOverview } from "./list.auth-overview.js";
import type { ProviderAuthOverview } from "./list.types.js";
import { resolveKnownAgentId } from "./shared.js";

export type ModelsAuthProfileStatus = {
  profileId: string;
  label: string;
  provider: string;
  type: "oauth" | "token" | "api_key";
  healthStatus: "ok" | "expiring" | "expired" | "missing" | "static";
  expiresAt?: number;
  remainingMs?: number;
  lastUsed?: number;
  errorCount?: number;
  disabledReason?: AuthProfileFailureReason;
  failureCounts?: Partial<Record<AuthProfileFailureReason, number>>;
  unusableKind: "available" | "cooldown" | "disabled";
  unusableUntil?: number;
  unusableRemainingMs?: number;
  inStoredOrder: boolean;
  isCurrent: boolean;
  isLastGood: boolean;
};

export type ModelsAuthProviderStatus = {
  provider: string;
  status: "ok" | "expiring" | "expired" | "missing" | "static";
  inUse: boolean;
  effective: ProviderAuthOverview["effective"];
  counts: {
    total: number;
    oauth: number;
    token: number;
    apiKey: number;
    available: number;
    unavailable: number;
  };
  activeProfileId: string | null;
  lastGoodProfileId: string | null;
  storedOrder: string[] | null;
  configuredOrder: string[] | null;
  currentOrder: string[];
  orderSource: "stored" | "config" | "derived";
  hasStoredOrderOverride: boolean;
  profiles: ModelsAuthProfileStatus[];
};

export type ModelsAuthStatusResult = {
  agentId: string;
  agentDir: string;
  authStorePath: string;
  inUseProviders: string[];
  missingProvidersInUse: string[];
  providers: ModelsAuthProviderStatus[];
};

type ResolvedTargetAgent = {
  agentId: string;
  agentDir: string;
  cfg: OpenClawConfig;
};

function rankProviderStatus(status: ModelsAuthProviderStatus["status"]): number {
  switch (status) {
    case "ok":
      return 0;
    case "expiring":
      return 1;
    case "static":
      return 2;
    case "expired":
      return 3;
    case "missing":
      return 4;
    default:
      return 5;
  }
}

function resolveTargetAgent(rawAgentId?: string): ResolvedTargetAgent {
  const cfg = loadConfig();
  const agentId = resolveKnownAgentId({ cfg, rawAgentId }) ?? resolveDefaultAgentId(cfg);
  const agentDir = resolveAgentDir(cfg, agentId);
  return { agentId, agentDir, cfg };
}

function collectProviderSets(params: {
  cfg: OpenClawConfig;
  agentId: string;
  store: ReturnType<typeof ensureAuthProfileStore>;
}): { providers: string[]; providersInUse: string[] } {
  const { cfg, agentId, store } = params;
  const agentModelPrimary = resolveAgentExplicitModelPrimary(cfg, agentId) ?? undefined;
  const agentFallbacksOverride = resolveAgentModelFallbacksOverride(cfg, agentId);
  const resolved = resolveDefaultModelForAgent({ cfg, agentId });

  const rawDefaultsModel = resolveAgentModelPrimaryValue(cfg.agents?.defaults?.model) ?? "";
  const rawModel = agentModelPrimary ?? rawDefaultsModel;
  const defaultLabel = rawModel || `${resolved.provider}/${resolved.model}`;
  const defaultsFallbacks = resolveAgentModelFallbackValues(cfg.agents?.defaults?.model);
  const fallbacks = agentFallbacksOverride ?? defaultsFallbacks;
  const imageModel = resolveAgentModelPrimaryValue(cfg.agents?.defaults?.imageModel) ?? "";
  const imageFallbacks = resolveAgentModelFallbackValues(cfg.agents?.defaults?.imageModel);
  const allowed = Object.keys(cfg.agents?.defaults?.models ?? {});

  const providersFromStore = new Set(
    Object.values(store.profiles)
      .map((profile) => normalizeProviderId(profile.provider))
      .filter(Boolean),
  );
  const providersFromConfig = new Set(
    Object.keys(cfg.models?.providers ?? {})
      .map((provider) => normalizeProviderId(provider))
      .filter(Boolean),
  );
  const providersFromModels = new Set<string>();
  const providersInUse = new Set<string>();

  for (const raw of [defaultLabel, ...fallbacks, imageModel, ...imageFallbacks, ...allowed]) {
    const parsed = parseModelRef(String(raw ?? ""), DEFAULT_PROVIDER);
    if (parsed?.provider) {
      providersFromModels.add(normalizeProviderId(parsed.provider));
    }
  }

  for (const raw of [defaultLabel, ...fallbacks, imageModel, ...imageFallbacks]) {
    const parsed = parseModelRef(String(raw ?? ""), DEFAULT_PROVIDER);
    if (parsed?.provider) {
      providersInUse.add(normalizeProviderId(parsed.provider));
    }
  }

  const providersFromEnv = new Set<string>();
  for (const provider of [
    "anthropic",
    "github-copilot",
    "google-vertex",
    "openai",
    "google",
    "groq",
    "cerebras",
    "xai",
    "openrouter",
    "zai",
    "mistral",
    "synthetic",
  ]) {
    if (resolveEnvApiKey(provider)) {
      providersFromEnv.add(normalizeProviderId(provider));
    }
  }

  const providers = Array.from(
    new Set([
      ...providersFromStore,
      ...providersFromConfig,
      ...providersFromModels,
      ...providersFromEnv,
    ]),
  ).toSorted((a, b) => a.localeCompare(b));

  return {
    providers,
    providersInUse: Array.from(providersInUse).toSorted((a, b) => a.localeCompare(b)),
  };
}

function resolveStatsEntry(
  usageStats: Record<string, ProfileUsageStats> | undefined,
  profileId: string,
): ProfileUsageStats {
  return usageStats?.[profileId] ?? {};
}

export function getModelsAuthStatus(rawAgentId?: string): ModelsAuthStatusResult {
  const { cfg, agentDir, agentId } = resolveTargetAgent(rawAgentId);
  const store = ensureAuthProfileStore(agentDir, {
    allowKeychainPrompt: false,
  });
  const { providers, providersInUse } = collectProviderSets({ cfg, agentId, store });

  const providerAuth = providers
    .map((provider) => resolveProviderAuthOverview({ provider, cfg, store, modelsPath: `${agentDir}/models.json` }))
    .filter((entry) => {
      const hasAny =
        entry.profiles.count > 0 || Boolean(entry.env) || Boolean(entry.modelsJson) || providersInUse.includes(entry.provider);
      return hasAny;
    });
  const providerAuthMap = new Map(providerAuth.map((entry) => [normalizeProviderId(entry.provider), entry]));
  const authHealth = buildAuthHealthSummary({
    store,
    cfg,
    warnAfterMs: DEFAULT_OAUTH_WARN_MS,
    providers,
  });
  const healthByProvider = new Map(
    authHealth.providers.map((entry) => [normalizeProviderId(entry.provider), entry]),
  );
  const healthByProfileId = new Map(authHealth.profiles.map((entry) => [entry.profileId, entry]));

  const providerStatuses = providerAuth
    .map((entry) => {
      const providerKey = normalizeProviderId(entry.provider);
      const storedOrder = findNormalizedProviderValue(store.order, providerKey) ?? null;
      const configuredOrder = findNormalizedProviderValue(cfg.auth?.order, providerKey) ?? null;
      const currentOrder = resolveAuthProfileOrder({
        cfg,
        store,
        provider: providerKey,
      });
      const activeProfileId = currentOrder[0] ?? null;
      const lastGoodProfileId =
        findNormalizedProviderValue(store.lastGood, providerKey) ?? null;
      const profiles = Object.entries(store.profiles)
        .filter(([, credential]) => normalizeProviderId(credential.provider) === providerKey)
        .map(([profileId, credential]) => {
          const health = healthByProfileId.get(profileId);
          const stats = resolveStatsEntry(store.usageStats, profileId);
          const unusableUntil = resolveProfileUnusableUntilForDisplay(store, profileId);
          const now = Date.now();
          const unusableKind =
            typeof stats.disabledUntil === "number" && now < stats.disabledUntil
              ? "disabled"
              : typeof unusableUntil === "number" && now < unusableUntil
                ? "cooldown"
                : "available";
          return {
            profileId,
            label:
              health?.label ??
              resolveAuthProfileDisplayLabel({
                cfg,
                store,
                profileId,
              }),
            provider: providerKey,
            type: credential.type,
            healthStatus: health?.status ?? "missing",
            expiresAt: health?.expiresAt,
            remainingMs: health?.remainingMs,
            lastUsed: stats.lastUsed,
            errorCount: stats.errorCount,
            disabledReason: stats.disabledReason,
            failureCounts: stats.failureCounts,
            unusableKind,
            unusableUntil: unusableUntil ?? undefined,
            unusableRemainingMs:
              typeof unusableUntil === "number" && now < unusableUntil
                ? unusableUntil - now
                : undefined,
            inStoredOrder: Boolean(storedOrder?.includes(profileId)),
            isCurrent: activeProfileId === profileId,
            isLastGood: lastGoodProfileId === profileId,
          } satisfies ModelsAuthProfileStatus;
        })
        .toSorted((a, b) => {
          const indexA = currentOrder.indexOf(a.profileId);
          const indexB = currentOrder.indexOf(b.profileId);
          if (indexA >= 0 || indexB >= 0) {
            const safeA = indexA >= 0 ? indexA : Number.MAX_SAFE_INTEGER;
            const safeB = indexB >= 0 ? indexB : Number.MAX_SAFE_INTEGER;
            if (safeA !== safeB) {
              return safeA - safeB;
            }
          }
          return a.profileId.localeCompare(b.profileId);
        });

      const providerHealth = healthByProvider.get(providerKey);
      return {
        provider: providerKey,
        status: providerHealth?.status ?? "missing",
        inUse: providersInUse.includes(providerKey),
        effective: entry.effective,
        counts: {
          total: profiles.length,
          oauth: profiles.filter((profile) => profile.type === "oauth").length,
          token: profiles.filter((profile) => profile.type === "token").length,
          apiKey: profiles.filter((profile) => profile.type === "api_key").length,
          available: profiles.filter((profile) => profile.unusableKind === "available").length,
          unavailable: profiles.filter((profile) => profile.unusableKind !== "available").length,
        },
        activeProfileId,
        lastGoodProfileId,
        storedOrder,
        configuredOrder,
        currentOrder,
        orderSource: storedOrder ? "stored" : configuredOrder ? "config" : "derived",
        hasStoredOrderOverride: Boolean(storedOrder && storedOrder.length > 0),
        profiles,
      } satisfies ModelsAuthProviderStatus;
    })
    .toSorted((a, b) => {
      if (a.inUse !== b.inUse) {
        return a.inUse ? -1 : 1;
      }
      const statusRankDiff = rankProviderStatus(a.status) - rankProviderStatus(b.status);
      if (statusRankDiff !== 0) {
        return statusRankDiff;
      }
      return a.provider.localeCompare(b.provider);
    });

  const providerStatusMap = new Map(
    providerStatuses.map((entry) => [normalizeProviderId(entry.provider), entry]),
  );
  const missingProvidersInUse = providersInUse.filter((provider) => !providerStatusMap.has(provider));

  return {
    agentId,
    agentDir,
    authStorePath: resolveAuthStorePathForDisplay(agentDir),
    inUseProviders: providersInUse,
    missingProvidersInUse,
    providers: providerStatuses,
  };
}
