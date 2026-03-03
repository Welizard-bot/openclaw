import { html, nothing } from "lit";
import { ConnectErrorDetailCodes } from "../../../../src/gateway/protocol/connect-error-details.js";
import { t, i18n, SUPPORTED_LOCALES, type Locale } from "../../i18n/index.ts";
import { buildExternalLinkRel, EXTERNAL_LINK_TARGET } from "../external-link.ts";
import { formatRelativeTimestamp, formatDurationHuman } from "../format.ts";
import type { GatewayHelloOk } from "../gateway.ts";
import { formatNextRun } from "../presenter.ts";
import type { UiSettings } from "../storage.ts";
import type {
  ModelsAuthProfileStatus,
  ModelsAuthProviderStatus,
  ModelsAuthStatusResult,
} from "../types.ts";
import { shouldShowPairingHint } from "./overview-hints.ts";

export type OverviewProps = {
  connected: boolean;
  hello: GatewayHelloOk | null;
  settings: UiSettings;
  password: string;
  lastError: string | null;
  lastErrorCode: string | null;
  presenceCount: number;
  sessionsCount: number | null;
  cronEnabled: boolean | null;
  cronNext: number | null;
  lastChannelsRefresh: number | null;
  modelAuthLoading: boolean;
  modelAuthBusyKey: string | null;
  modelAuthError: string | null;
  modelAuthStatus: ModelsAuthStatusResult | null;
  onSettingsChange: (next: UiSettings) => void;
  onPasswordChange: (next: string) => void;
  onSessionKeyChange: (next: string) => void;
  onConnect: () => void;
  onRefresh: () => void;
  onModelAuthRefresh: () => void;
  onPromoteProfile: (provider: string, profileId: string) => void;
  onClearProviderOrder: (provider: string) => void;
  onClearProfileCooldown: (profileId: string) => void;
};

function resolveAuthStatusChipClass(status: ModelsAuthProviderStatus["status"]) {
  switch (status) {
    case "ok":
      return "chip chip-ok";
    case "expiring":
      return "chip chip-warn";
    case "expired":
    case "missing":
      return "chip chip-danger";
    default:
      return "chip";
  }
}

function formatOrderSource(source: ModelsAuthProviderStatus["orderSource"]) {
  switch (source) {
    case "stored":
      return t("overview.accounts.orderStored");
    case "config":
      return t("overview.accounts.orderConfig");
    default:
      return t("overview.accounts.orderDerived");
  }
}

function formatEffectiveSource(entry: ModelsAuthProviderStatus) {
  const kind = entry.effective.kind;
  if (kind === "profiles") {
    return t("overview.accounts.sourceProfiles");
  }
  if (kind === "env") {
    return t("overview.accounts.sourceEnv");
  }
  if (kind === "models.json") {
    return "models.json";
  }
  return t("overview.accounts.sourceMissing");
}

function formatProfileType(type: ModelsAuthProfileStatus["type"]) {
  if (type === "oauth") {
    return t("overview.accounts.typeOauth");
  }
  if (type === "token") {
    return t("overview.accounts.typeToken");
  }
  return t("overview.accounts.typeApiKey");
}

function formatProfileState(profile: ModelsAuthProfileStatus) {
  if (profile.unusableKind === "disabled") {
    const reason = profile.disabledReason ? ` · ${profile.disabledReason}` : "";
    const remaining = profile.unusableRemainingMs
      ? ` · ${formatDurationHuman(profile.unusableRemainingMs)}`
      : "";
    return `${t("overview.accounts.disabled")}${reason}${remaining}`;
  }
  if (profile.unusableKind === "cooldown") {
    const remaining = profile.unusableRemainingMs
      ? ` · ${formatDurationHuman(profile.unusableRemainingMs)}`
      : "";
    return `${t("overview.accounts.cooldown")}${remaining}`;
  }
  if (profile.healthStatus === "expiring" && profile.remainingMs != null) {
    return `${t("overview.accounts.expiring")} · ${formatDurationHuman(profile.remainingMs)}`;
  }
  if (profile.healthStatus === "expired") {
    return t("overview.accounts.expired");
  }
  return t("overview.accounts.available");
}

function renderProfileRow(
  provider: ModelsAuthProviderStatus,
  profile: ModelsAuthProfileStatus,
  props: OverviewProps,
) {
  const isBusy =
    props.modelAuthBusyKey != null &&
    (props.modelAuthBusyKey === `promote:${provider.provider}:${profile.profileId}` ||
      props.modelAuthBusyKey === `clear-cooldown:${profile.profileId}`);
  return html`
    <div
      class="overview-auth-profile ${profile.isCurrent ? "overview-auth-profile--current" : ""} ${profile.unusableKind !== "available" ? "overview-auth-profile--blocked" : ""}"
    >
      <div class="overview-auth-profile__main">
        <div class="overview-auth-profile__title">
          <span>${profile.label}</span>
          <span class="overview-auth-profile__id mono">${profile.profileId}</span>
        </div>
        <div class="chip-row" style="margin-top: 10px;">
          <span class="chip">${formatProfileType(profile.type)}</span>
          ${profile.isCurrent
            ? html`<span class="chip chip-ok">${t("overview.accounts.current")}</span>`
            : nothing}
          ${profile.isLastGood
            ? html`<span class="chip">${t("overview.accounts.lastGood")}</span>`
            : nothing}
          <span
            class=${profile.unusableKind === "available"
              ? "chip"
              : profile.unusableKind === "cooldown"
                ? "chip chip-warn"
                : "chip chip-danger"}
            >${formatProfileState(profile)}</span
          >
          <span class="chip"
            >${t("overview.accounts.lastUsed")}: ${profile.lastUsed
              ? formatRelativeTimestamp(profile.lastUsed)
              : t("overview.accounts.neverUsed")}</span
          >
          ${typeof profile.errorCount === "number"
            ? html`<span class="chip">${t("overview.accounts.errors")}: ${profile.errorCount}</span>`
            : nothing}
        </div>
      </div>
      <div class="overview-auth-profile__actions">
        <button
          class="btn btn--sm"
          ?disabled=${Boolean(props.modelAuthBusyKey) || profile.isCurrent}
          @click=${() => props.onPromoteProfile(provider.provider, profile.profileId)}
        >
          ${t("overview.accounts.makePrimary")}
        </button>
        ${profile.unusableKind !== "available"
          ? html`<button
              class="btn btn--sm"
              ?disabled=${Boolean(props.modelAuthBusyKey) || isBusy}
              @click=${() => props.onClearProfileCooldown(profile.profileId)}
            >
              ${t("overview.accounts.clearCooldown")}
            </button>`
          : nothing}
      </div>
    </div>
  `;
}

function renderAuthProviderCard(entry: ModelsAuthProviderStatus, props: OverviewProps) {
  const activeProfile =
    entry.profiles.find((profile) => profile.profileId === entry.activeProfileId) ?? null;
  return html`
    <section class="overview-auth-provider ${entry.inUse ? "overview-auth-provider--in-use" : ""}">
      <div class="overview-auth-provider__header">
        <div>
          <div class="overview-auth-provider__title">
            <span class="mono">${entry.provider}</span>
            ${entry.inUse ? html`<span class="chip chip-ok">${t("overview.accounts.inUse")}</span>` : nothing}
            <span class=${resolveAuthStatusChipClass(entry.status)}>${t(`overview.accounts.status.${entry.status}`)}</span>
          </div>
          <div class="overview-auth-provider__meta">
            ${t("overview.accounts.source")}: ${formatEffectiveSource(entry)}
            <span class="muted"> · </span>
            ${t("overview.accounts.order")}: ${formatOrderSource(entry.orderSource)}
          </div>
        </div>
        <div class="overview-auth-provider__actions">
          <button class="btn btn--sm" ?disabled=${Boolean(props.modelAuthBusyKey) || !entry.hasStoredOrderOverride} @click=${() => props.onClearProviderOrder(entry.provider)}>
            ${t("overview.accounts.resetOrder")}
          </button>
        </div>
      </div>

      <div class="chip-row" style="margin-top: 12px;">
        <span class="chip">${t("overview.accounts.countProfiles")}: ${entry.counts.total}</span>
        <span class="chip">${t("overview.accounts.countAvailable")}: ${entry.counts.available}</span>
        <span class="chip">${t("overview.accounts.countBlocked")}: ${entry.counts.unavailable}</span>
        ${activeProfile
          ? html`<span class="chip chip-ok">${t("overview.accounts.activeProfile")}: ${activeProfile.profileId}</span>`
          : nothing}
      </div>

      ${entry.profiles.length === 0
        ? html`<div class="callout info" style="margin-top: 14px;">${t("overview.accounts.noProfiles")}</div>`
        : html`<div class="overview-auth-profile-list">
            ${entry.profiles.map((profile) => renderProfileRow(entry, profile, props))}
          </div>`}
    </section>
  `;
}

export function renderOverview(props: OverviewProps) {
  const snapshot = props.hello?.snapshot as
    | {
        uptimeMs?: number;
        policy?: { tickIntervalMs?: number };
        authMode?: "none" | "token" | "password" | "trusted-proxy";
      }
    | undefined;
  const uptime = snapshot?.uptimeMs ? formatDurationHuman(snapshot.uptimeMs) : t("common.na");
  const tick = snapshot?.policy?.tickIntervalMs
    ? `${snapshot.policy.tickIntervalMs}ms`
    : t("common.na");
  const authMode = snapshot?.authMode;
  const isTrustedProxy = authMode === "trusted-proxy";

  const pairingHint = (() => {
    if (!shouldShowPairingHint(props.connected, props.lastError, props.lastErrorCode)) {
      return null;
    }
    return html`
      <div class="muted" style="margin-top: 8px">
        ${t("overview.pairing.hint")}
        <div style="margin-top: 6px">
          <span class="mono">openclaw devices list</span><br />
          <span class="mono">openclaw devices approve &lt;requestId&gt;</span>
        </div>
        <div style="margin-top: 6px; font-size: 12px;">
          ${t("overview.pairing.mobileHint")}
        </div>
        <div style="margin-top: 6px">
          <a
            class="session-link"
            href="https://docs.openclaw.ai/web/control-ui#device-pairing-first-connection"
            target=${EXTERNAL_LINK_TARGET}
            rel=${buildExternalLinkRel()}
            title="Device pairing docs (opens in new tab)"
            >Docs: Device pairing</a
          >
        </div>
      </div>
    `;
  })();

  const authHint = (() => {
    if (props.connected || !props.lastError) {
      return null;
    }
    const lower = props.lastError.toLowerCase();
    const authRequiredCodes = new Set<string>([
      ConnectErrorDetailCodes.AUTH_REQUIRED,
      ConnectErrorDetailCodes.AUTH_TOKEN_MISSING,
      ConnectErrorDetailCodes.AUTH_PASSWORD_MISSING,
      ConnectErrorDetailCodes.AUTH_TOKEN_NOT_CONFIGURED,
      ConnectErrorDetailCodes.AUTH_PASSWORD_NOT_CONFIGURED,
    ]);
    const authFailureCodes = new Set<string>([
      ...authRequiredCodes,
      ConnectErrorDetailCodes.AUTH_UNAUTHORIZED,
      ConnectErrorDetailCodes.AUTH_TOKEN_MISMATCH,
      ConnectErrorDetailCodes.AUTH_PASSWORD_MISMATCH,
      ConnectErrorDetailCodes.AUTH_DEVICE_TOKEN_MISMATCH,
      ConnectErrorDetailCodes.AUTH_RATE_LIMITED,
      ConnectErrorDetailCodes.AUTH_TAILSCALE_IDENTITY_MISSING,
      ConnectErrorDetailCodes.AUTH_TAILSCALE_PROXY_MISSING,
      ConnectErrorDetailCodes.AUTH_TAILSCALE_WHOIS_FAILED,
      ConnectErrorDetailCodes.AUTH_TAILSCALE_IDENTITY_MISMATCH,
    ]);
    const authFailed = props.lastErrorCode
      ? authFailureCodes.has(props.lastErrorCode)
      : lower.includes("unauthorized") || lower.includes("connect failed");
    if (!authFailed) {
      return null;
    }
    const hasToken = Boolean(props.settings.token.trim());
    const hasPassword = Boolean(props.password.trim());
    const isAuthRequired = props.lastErrorCode
      ? authRequiredCodes.has(props.lastErrorCode)
      : !hasToken && !hasPassword;
    if (isAuthRequired) {
      return html`
        <div class="muted" style="margin-top: 8px">
          ${t("overview.auth.required")}
          <div style="margin-top: 6px">
            <span class="mono">openclaw dashboard --no-open</span> → tokenized URL<br />
            <span class="mono">openclaw doctor --generate-gateway-token</span> → set token
          </div>
          <div style="margin-top: 6px">
            <a
              class="session-link"
              href="https://docs.openclaw.ai/web/dashboard"
              target=${EXTERNAL_LINK_TARGET}
              rel=${buildExternalLinkRel()}
              title="Control UI auth docs (opens in new tab)"
              >Docs: Control UI auth</a
            >
          </div>
        </div>
      `;
    }
    return html`
      <div class="muted" style="margin-top: 8px">
        ${t("overview.auth.failed", { command: "openclaw dashboard --no-open" })}
        <div style="margin-top: 6px">
          <a
            class="session-link"
            href="https://docs.openclaw.ai/web/dashboard"
            target=${EXTERNAL_LINK_TARGET}
            rel=${buildExternalLinkRel()}
            title="Control UI auth docs (opens in new tab)"
            >Docs: Control UI auth</a
          >
        </div>
      </div>
    `;
  })();

  const insecureContextHint = (() => {
    if (props.connected || !props.lastError) {
      return null;
    }
    const isSecureContext = typeof window !== "undefined" ? window.isSecureContext : true;
    if (isSecureContext) {
      return null;
    }
    const lower = props.lastError.toLowerCase();
    const insecureContextCode =
      props.lastErrorCode === ConnectErrorDetailCodes.CONTROL_UI_DEVICE_IDENTITY_REQUIRED ||
      props.lastErrorCode === ConnectErrorDetailCodes.DEVICE_IDENTITY_REQUIRED;
    if (
      !insecureContextCode &&
      !lower.includes("secure context") &&
      !lower.includes("device identity required")
    ) {
      return null;
    }
    return html`
      <div class="muted" style="margin-top: 8px">
        ${t("overview.insecure.hint", { url: "http://127.0.0.1:18789" })}
        <div style="margin-top: 6px">
          ${t("overview.insecure.stayHttp", { config: "gateway.controlUi.allowInsecureAuth: true" })}
        </div>
        <div style="margin-top: 6px">
          <a
            class="session-link"
            href="https://docs.openclaw.ai/gateway/tailscale"
            target=${EXTERNAL_LINK_TARGET}
            rel=${buildExternalLinkRel()}
            title="Tailscale Serve docs (opens in new tab)"
            >Docs: Tailscale Serve</a
          >
          <span class="muted"> · </span>
          <a
            class="session-link"
            href="https://docs.openclaw.ai/web/control-ui#insecure-http"
            target=${EXTERNAL_LINK_TARGET}
            rel=${buildExternalLinkRel()}
            title="Insecure HTTP docs (opens in new tab)"
            >Docs: Insecure HTTP</a
          >
        </div>
      </div>
    `;
  })();

  const currentLocale = i18n.getLocale();

  return html`
    <section class="grid grid-cols-2">
      <div class="card">
        <div class="card-title">${t("overview.access.title")}</div>
        <div class="card-sub">${t("overview.access.subtitle")}</div>
        <div class="form-grid" style="margin-top: 16px;">
          <label class="field">
            <span>${t("overview.access.wsUrl")}</span>
            <input
              .value=${props.settings.gatewayUrl}
              @input=${(e: Event) => {
                const v = (e.target as HTMLInputElement).value;
                props.onSettingsChange({ ...props.settings, gatewayUrl: v });
              }}
              placeholder="ws://100.x.y.z:18789"
            />
          </label>
          ${
            isTrustedProxy
              ? ""
              : html`
                <label class="field">
                  <span>${t("overview.access.token")}</span>
                  <input
                    .value=${props.settings.token}
                    @input=${(e: Event) => {
                      const v = (e.target as HTMLInputElement).value;
                      props.onSettingsChange({ ...props.settings, token: v });
                    }}
                    placeholder="OPENCLAW_GATEWAY_TOKEN"
                  />
                </label>
                <label class="field">
                  <span>${t("overview.access.password")}</span>
                  <input
                    type="password"
                    .value=${props.password}
                    @input=${(e: Event) => {
                      const v = (e.target as HTMLInputElement).value;
                      props.onPasswordChange(v);
                    }}
                    placeholder="system or shared password"
                  />
                </label>
              `
          }
          <label class="field">
            <span>${t("overview.access.sessionKey")}</span>
            <input
              .value=${props.settings.sessionKey}
              @input=${(e: Event) => {
                const v = (e.target as HTMLInputElement).value;
                props.onSessionKeyChange(v);
              }}
            />
          </label>
          <label class="field">
            <span>${t("overview.access.language")}</span>
            <select
              .value=${currentLocale}
              @change=${(e: Event) => {
                const v = (e.target as HTMLSelectElement).value as Locale;
                void i18n.setLocale(v);
                props.onSettingsChange({ ...props.settings, locale: v });
              }}
            >
              ${SUPPORTED_LOCALES.map((loc) => {
                const key = loc.replace(/-([a-zA-Z])/g, (_, c) => c.toUpperCase());
                return html`<option value=${loc}>${t(`languages.${key}`)}</option>`;
              })}
            </select>
          </label>
        </div>
        <div class="row" style="margin-top: 14px;">
          <button class="btn" @click=${() => props.onConnect()}>${t("common.connect")}</button>
          <button class="btn" @click=${() => props.onRefresh()}>${t("common.refresh")}</button>
          <span class="muted">${
            isTrustedProxy ? t("overview.access.trustedProxy") : t("overview.access.connectHint")
          }</span>
        </div>
      </div>

      <div class="card">
        <div class="card-title">${t("overview.snapshot.title")}</div>
        <div class="card-sub">${t("overview.snapshot.subtitle")}</div>
        <div class="stat-grid" style="margin-top: 16px;">
          <div class="stat">
            <div class="stat-label">${t("overview.snapshot.status")}</div>
            <div class="stat-value ${props.connected ? "ok" : "warn"}">
              ${props.connected ? t("common.ok") : t("common.offline")}
            </div>
          </div>
          <div class="stat">
            <div class="stat-label">${t("overview.snapshot.uptime")}</div>
            <div class="stat-value">${uptime}</div>
          </div>
          <div class="stat">
            <div class="stat-label">${t("overview.snapshot.tickInterval")}</div>
            <div class="stat-value">${tick}</div>
          </div>
          <div class="stat">
            <div class="stat-label">${t("overview.snapshot.lastChannelsRefresh")}</div>
            <div class="stat-value">
              ${props.lastChannelsRefresh ? formatRelativeTimestamp(props.lastChannelsRefresh) : t("common.na")}
            </div>
          </div>
        </div>
        ${
          props.lastError
            ? html`<div class="callout danger" style="margin-top: 14px;">
              <div>${props.lastError}</div>
              ${pairingHint ?? ""}
              ${authHint ?? ""}
              ${insecureContextHint ?? ""}
            </div>`
            : html`
                <div class="callout" style="margin-top: 14px">
                  ${t("overview.snapshot.channelsHint")}
                </div>
              `
        }
      </div>
    </section>

    <section class="grid grid-cols-3" style="margin-top: 18px;">
      <div class="card stat-card">
        <div class="stat-label">${t("overview.stats.instances")}</div>
        <div class="stat-value">${props.presenceCount}</div>
        <div class="muted">${t("overview.stats.instancesHint")}</div>
      </div>
      <div class="card stat-card">
        <div class="stat-label">${t("overview.stats.sessions")}</div>
        <div class="stat-value">${props.sessionsCount ?? t("common.na")}</div>
        <div class="muted">${t("overview.stats.sessionsHint")}</div>
      </div>
      <div class="card stat-card">
        <div class="stat-label">${t("overview.stats.cron")}</div>
        <div class="stat-value">
          ${props.cronEnabled == null ? t("common.na") : props.cronEnabled ? t("common.enabled") : t("common.disabled")}
        </div>
        <div class="muted">${t("overview.stats.cronNext", { time: formatNextRun(props.cronNext) })}</div>
      </div>
    </section>

    <section class="card overview-auth" style="margin-top: 18px;">
      <div class="row" style="justify-content: space-between; align-items: flex-start; gap: 16px;">
        <div>
          <div class="card-title">${t("overview.accounts.title")}</div>
          <div class="card-sub">${t("overview.accounts.subtitle")}</div>
        </div>
        <div class="row" style="gap: 10px; align-items: center;">
          ${props.modelAuthStatus
            ? html`<span class="muted mono">${props.modelAuthStatus.authStorePath}</span>`
            : nothing}
          <button class="btn btn--sm" ?disabled=${props.modelAuthLoading || Boolean(props.modelAuthBusyKey)} @click=${() => props.onModelAuthRefresh()}>
            ${props.modelAuthLoading ? t("overview.accounts.refreshing") : t("common.refresh")}
          </button>
        </div>
      </div>

      ${props.modelAuthError
        ? html`<div class="callout danger" style="margin-top: 14px;">${props.modelAuthError}</div>`
        : nothing}

      ${props.modelAuthStatus?.missingProvidersInUse?.length
        ? html`<div class="callout danger" style="margin-top: 14px;">
            ${t("overview.accounts.missingProviders", {
              providers: props.modelAuthStatus.missingProvidersInUse.join(", "),
            })}
          </div>`
        : nothing}

      ${!props.modelAuthStatus
        ? html`<div class="callout info" style="margin-top: 14px;">${t("overview.accounts.empty")}</div>`
        : props.modelAuthStatus.providers.length === 0
          ? html`<div class="callout info" style="margin-top: 14px;">${t("overview.accounts.noProviders")}</div>`
          : html`<div class="overview-auth-grid">
              ${props.modelAuthStatus.providers.map((entry) => renderAuthProviderCard(entry, props))}
            </div>`}
    </section>

    <section class="card" style="margin-top: 18px;">
      <div class="card-title">${t("overview.notes.title")}</div>
      <div class="card-sub">${t("overview.notes.subtitle")}</div>
      <div class="note-grid" style="margin-top: 14px;">
        <div>
          <div class="note-title">${t("overview.notes.tailscaleTitle")}</div>
          <div class="muted">
            ${t("overview.notes.tailscaleText")}
          </div>
        </div>
        <div>
          <div class="note-title">${t("overview.notes.sessionTitle")}</div>
          <div class="muted">${t("overview.notes.sessionText")}</div>
        </div>
        <div>
          <div class="note-title">${t("overview.notes.cronTitle")}</div>
          <div class="muted">${t("overview.notes.cronText")}</div>
        </div>
      </div>
    </section>
  `;
}
