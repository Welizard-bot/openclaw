import { DEFAULT_PROVIDER } from "../../agents/defaults.js";
import {
  clearAuthProfileCooldown,
  deleteAuthProfile,
  ensureAuthProfileStore,
  resolveAuthProfileOrder,
  setAuthProfileManualDisabled,
  setAuthProfileOrder,
} from "../../agents/auth-profiles.js";
import { buildAllowedModelSet, normalizeProviderId } from "../../agents/model-selection.js";
import { getModelsAuthStatus } from "../../commands/models/auth-status.js";
import { loadConfig } from "../../config/config.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateModelsAuthCooldownClearParams,
  validateModelsAuthProfileDeleteParams,
  validateModelsAuthProfileDisableParams,
  validateModelsAuthProfileEnableParams,
  validateModelsAuthOrderClearParams,
  validateModelsAuthPromoteParams,
  validateModelsAuthStatusParams,
  validateModelsListParams,
} from "../protocol/index.js";
import type { GatewayRequestHandlers } from "./types.js";

export const modelsHandlers: GatewayRequestHandlers = {
  "models.list": async ({ params, respond, context }) => {
    if (!validateModelsListParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid models.list params: ${formatValidationErrors(validateModelsListParams.errors)}`,
        ),
      );
      return;
    }
    try {
      const catalog = await context.loadGatewayModelCatalog();
      const cfg = loadConfig();
      const { allowedCatalog } = buildAllowedModelSet({
        cfg,
        catalog,
        defaultProvider: DEFAULT_PROVIDER,
      });
      const models = allowedCatalog.length > 0 ? allowedCatalog : catalog;
      respond(true, { models }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },
  "models.auth.status": ({ params, respond }) => {
    if (!validateModelsAuthStatusParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid models.auth.status params: ${formatValidationErrors(validateModelsAuthStatusParams.errors)}`,
        ),
      );
      return;
    }
    try {
      const agentId = typeof params.agentId === "string" ? params.agentId.trim() : undefined;
      respond(true, getModelsAuthStatus(agentId), undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },
  "models.auth.promote": async ({ params, respond }) => {
    if (!validateModelsAuthPromoteParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid models.auth.promote params: ${formatValidationErrors(validateModelsAuthPromoteParams.errors)}`,
        ),
      );
      return;
    }
    try {
      const status = getModelsAuthStatus(typeof params.agentId === "string" ? params.agentId.trim() : undefined);
      const provider = normalizeProviderId(String(params.provider ?? "").trim());
      const profileId = String(params.profileId ?? "").trim();
      const entry = status.providers.find((item) => item.provider === provider);
      if (!entry) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `unknown provider "${provider}"`),
        );
        return;
      }
      if (!entry.profiles.some((profile) => profile.profileId === profileId)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `profile "${profileId}" is not available for provider "${provider}"`,
          ),
        );
        return;
      }
      const currentOrder = entry.currentOrder.length
        ? entry.currentOrder
        : resolveAuthProfileOrder({
            store: ensureAuthProfileStore(status.agentDir, { allowKeychainPrompt: false }),
            provider,
          });
      const knownProfileIds = [
        ...currentOrder,
        ...entry.profiles
          .map((profile) => profile.profileId)
          .filter((id) => !currentOrder.includes(id)),
      ];
      const nextOrder = [profileId, ...knownProfileIds.filter((id) => id !== profileId)];
      const updated = await setAuthProfileOrder({
        agentDir: status.agentDir,
        provider,
        order: nextOrder,
      });
      if (!updated) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.UNAVAILABLE, "Failed to update auth-profiles.json (lock busy?)."),
        );
        return;
      }
      respond(true, getModelsAuthStatus(status.agentId), undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },
  "models.auth.order.clear": async ({ params, respond }) => {
    if (!validateModelsAuthOrderClearParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid models.auth.order.clear params: ${formatValidationErrors(validateModelsAuthOrderClearParams.errors)}`,
        ),
      );
      return;
    }
    try {
      const status = getModelsAuthStatus(typeof params.agentId === "string" ? params.agentId.trim() : undefined);
      const provider = normalizeProviderId(String(params.provider ?? "").trim());
      const updated = await setAuthProfileOrder({
        agentDir: status.agentDir,
        provider,
        order: null,
      });
      if (!updated && !status.providers.some((entry) => entry.provider === provider && entry.hasStoredOrderOverride)) {
        respond(true, status, undefined);
        return;
      }
      respond(true, getModelsAuthStatus(status.agentId), undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },
  "models.auth.cooldown.clear": async ({ params, respond }) => {
    if (!validateModelsAuthCooldownClearParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid models.auth.cooldown.clear params: ${formatValidationErrors(validateModelsAuthCooldownClearParams.errors)}`,
        ),
      );
      return;
    }
    try {
      const status = getModelsAuthStatus(typeof params.agentId === "string" ? params.agentId.trim() : undefined);
      const profileId = String(params.profileId ?? "").trim();
      const store = ensureAuthProfileStore(status.agentDir, { allowKeychainPrompt: false });
      if (!store.profiles[profileId]) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `unknown auth profile "${profileId}"`),
        );
        return;
      }
      await clearAuthProfileCooldown({
        store,
        profileId,
        agentDir: status.agentDir,
      });
      respond(true, getModelsAuthStatus(status.agentId), undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },
  "models.auth.profile.disable": async ({ params, respond }) => {
    if (!validateModelsAuthProfileDisableParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid models.auth.profile.disable params: ${formatValidationErrors(validateModelsAuthProfileDisableParams.errors)}`,
        ),
      );
      return;
    }
    try {
      const status = getModelsAuthStatus(typeof params.agentId === "string" ? params.agentId.trim() : undefined);
      const profileId = String(params.profileId ?? "").trim();
      if (!status.providers.some((entry) => entry.profiles.some((profile) => profile.profileId === profileId))) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `unknown auth profile "${profileId}"`),
        );
        return;
      }
      const updated = await setAuthProfileManualDisabled({
        agentDir: status.agentDir,
        profileId,
        disabled: true,
      });
      if (!updated) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.UNAVAILABLE, "Failed to disable auth profile."),
        );
        return;
      }
      respond(true, getModelsAuthStatus(status.agentId), undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },
  "models.auth.profile.enable": async ({ params, respond }) => {
    if (!validateModelsAuthProfileEnableParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid models.auth.profile.enable params: ${formatValidationErrors(validateModelsAuthProfileEnableParams.errors)}`,
        ),
      );
      return;
    }
    try {
      const status = getModelsAuthStatus(typeof params.agentId === "string" ? params.agentId.trim() : undefined);
      const profileId = String(params.profileId ?? "").trim();
      if (!status.providers.some((entry) => entry.profiles.some((profile) => profile.profileId === profileId))) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `unknown auth profile "${profileId}"`),
        );
        return;
      }
      const updated = await setAuthProfileManualDisabled({
        agentDir: status.agentDir,
        profileId,
        disabled: false,
      });
      if (!updated) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.UNAVAILABLE, "Failed to enable auth profile."),
        );
        return;
      }
      respond(true, getModelsAuthStatus(status.agentId), undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },
  "models.auth.profile.delete": async ({ params, respond }) => {
    if (!validateModelsAuthProfileDeleteParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid models.auth.profile.delete params: ${formatValidationErrors(validateModelsAuthProfileDeleteParams.errors)}`,
        ),
      );
      return;
    }
    try {
      const status = getModelsAuthStatus(typeof params.agentId === "string" ? params.agentId.trim() : undefined);
      const profileId = String(params.profileId ?? "").trim();
      if (!status.providers.some((entry) => entry.profiles.some((profile) => profile.profileId === profileId))) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `unknown auth profile "${profileId}"`),
        );
        return;
      }
      const updated = await deleteAuthProfile({
        agentDir: status.agentDir,
        profileId,
      });
      if (!updated) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.UNAVAILABLE, "Failed to delete auth profile."),
        );
        return;
      }
      respond(true, getModelsAuthStatus(status.agentId), undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },
};
