import type { GatewayBrowserClient } from "../gateway.ts";
import type { WizardNextResult, WizardStartResult, WizardStep } from "../types.ts";

export type SetupWizardMode = "local" | "remote";
export type SetupWizardStatus = WizardStartResult["status"] | null;

export type SetupWizardState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  wizardOpen: boolean;
  wizardLoading: boolean;
  wizardBusy: boolean;
  wizardMode: SetupWizardMode;
  wizardSessionId: string | null;
  wizardStatus: SetupWizardStatus;
  wizardError: string | null;
  wizardStep: WizardStep | null;
  wizardDraftValue: unknown;
  loadOverview?: () => Promise<void>;
};

function resolveInitialDraft(step: WizardStep | null): unknown {
  if (!step) {
    return null;
  }
  if (step.type === "confirm") {
    return Boolean(step.initialValue);
  }
  if (step.type === "multiselect") {
    return Array.isArray(step.initialValue) ? step.initialValue : [];
  }
  if (step.type === "select") {
    if (step.initialValue !== undefined) {
      return step.initialValue;
    }
    return step.options?.[0]?.value ?? null;
  }
  if (step.type === "text") {
    return typeof step.initialValue === "string" ? step.initialValue : "";
  }
  return null;
}

function applyWizardResult(
  state: SetupWizardState,
  result: WizardStartResult | WizardNextResult,
  sessionId?: string | null,
) {
  state.wizardOpen = true;
  state.wizardLoading = false;
  state.wizardBusy = false;
  state.wizardStatus = result.status ?? (result.done ? "done" : "running");
  state.wizardError = result.error ?? null;
  state.wizardSessionId = result.done ? null : (sessionId ?? state.wizardSessionId);
  state.wizardStep = result.done ? null : (result.step ?? null);
  state.wizardDraftValue = resolveInitialDraft(state.wizardStep);
  if (result.done) {
    void state.loadOverview?.();
  }
}

function resetWizardState(state: SetupWizardState) {
  state.wizardOpen = false;
  state.wizardLoading = false;
  state.wizardBusy = false;
  state.wizardSessionId = null;
  state.wizardStatus = null;
  state.wizardError = null;
  state.wizardStep = null;
  state.wizardDraftValue = null;
}

export function updateSetupWizardDraft(state: SetupWizardState, value: unknown) {
  state.wizardDraftValue = value;
}

export function dismissSetupWizard(state: SetupWizardState) {
  resetWizardState(state);
}

export async function startSetupWizard(state: SetupWizardState, mode: SetupWizardMode) {
  if (!state.client || !state.connected || state.wizardLoading || state.wizardBusy) {
    return;
  }
  state.wizardOpen = true;
  state.wizardLoading = true;
  state.wizardBusy = false;
  state.wizardMode = mode;
  state.wizardSessionId = null;
  state.wizardStatus = "running";
  state.wizardError = null;
  state.wizardStep = null;
  state.wizardDraftValue = null;
  try {
    const result = await state.client.request<WizardStartResult>("wizard.start", { mode });
    applyWizardResult(state, result, result.sessionId ?? null);
  } catch (err) {
    state.wizardLoading = false;
    state.wizardError = String(err);
    state.wizardStatus = "error";
  }
}

export async function submitSetupWizard(state: SetupWizardState) {
  if (!state.client || !state.connected || !state.wizardSessionId || !state.wizardStep) {
    return;
  }
  if (state.wizardLoading || state.wizardBusy) {
    return;
  }
  state.wizardBusy = true;
  state.wizardError = null;
  const requiresAnswer =
    state.wizardStep.type !== "note" &&
    state.wizardStep.type !== "progress" &&
    state.wizardStep.type !== "action";
  try {
    const result = await state.client.request<WizardNextResult>("wizard.next", {
      sessionId: state.wizardSessionId,
      answer: {
        stepId: state.wizardStep.id,
        value: requiresAnswer ? state.wizardDraftValue : null,
      },
    });
    applyWizardResult(state, result);
  } catch (err) {
    state.wizardBusy = false;
    state.wizardError = String(err);
    state.wizardStatus = "error";
  }
}

export async function cancelSetupWizard(state: SetupWizardState) {
  if (state.client && state.connected && state.wizardSessionId) {
    try {
      await state.client.request("wizard.cancel", { sessionId: state.wizardSessionId });
    } catch {
      // Ignore cancellation transport errors; local state still needs to clear.
    }
  }
  resetWizardState(state);
}
