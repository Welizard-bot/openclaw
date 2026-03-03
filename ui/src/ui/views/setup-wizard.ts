import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import type { AppViewState } from "../app-view-state.ts";
import type { WizardStep } from "../types.ts";

function wizardValueEquals(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }
  if (
    left !== null &&
    right !== null &&
    left !== undefined &&
    right !== undefined &&
    typeof left === "object" &&
    typeof right === "object"
  ) {
    try {
      return JSON.stringify(left) === JSON.stringify(right);
    } catch {
      return false;
    }
  }
  return String(left) === String(right);
}

function wizardArrayIncludes(values: unknown[], candidate: unknown): boolean {
  return values.some((value) => wizardValueEquals(value, candidate));
}

function toggleWizardMultiValue(values: unknown[], candidate: unknown): unknown[] {
  return wizardArrayIncludes(values, candidate)
    ? values.filter((value) => !wizardValueEquals(value, candidate))
    : [...values, candidate];
}

function renderWizardStep(step: WizardStep, state: AppViewState) {
  const options = step.options ?? [];
  if (step.type === "text") {
    return html`
      <label class="field" style="margin-top: 14px;">
        <span>${step.message ?? ""}</span>
        <input
          type=${step.sensitive ? "password" : "text"}
          .value=${typeof state.wizardDraftValue === "string" ? state.wizardDraftValue : ""}
          placeholder=${step.placeholder ?? ""}
          @input=${(event: Event) =>
            state.handleUpdateSetupWizardDraft((event.target as HTMLInputElement).value)}
        />
      </label>
    `;
  }
  if (step.type === "confirm") {
    const current = Boolean(state.wizardDraftValue);
    return html`
      <div class="wizard-step-message">${step.message ?? ""}</div>
      <div class="wizard-option-list" style="margin-top: 14px;">
        <button
          class="wizard-option ${current ? "active" : ""}"
          @click=${() => state.handleUpdateSetupWizardDraft(true)}
        >
          <div class="wizard-option__label">${t("wizard.confirmYes")}</div>
        </button>
        <button
          class="wizard-option ${!current ? "active" : ""}"
          @click=${() => state.handleUpdateSetupWizardDraft(false)}
        >
          <div class="wizard-option__label">${t("wizard.confirmNo")}</div>
        </button>
      </div>
    `;
  }
  if (step.type === "select") {
    return html`
      ${step.message ? html`<div class="wizard-step-message">${step.message}</div>` : nothing}
      <div class="wizard-option-list" style="margin-top: 14px;">
        ${options.map(
          (option) => html`
            <button
              class="wizard-option ${wizardValueEquals(state.wizardDraftValue, option.value)
                ? "active"
                : ""}"
              @click=${() => state.handleUpdateSetupWizardDraft(option.value)}
            >
              <div class="wizard-option__label">${option.label}</div>
              ${option.hint
                ? html`<div class="wizard-option__hint">${option.hint}</div>`
                : nothing}
            </button>
          `,
        )}
      </div>
    `;
  }
  if (step.type === "multiselect") {
    const current = Array.isArray(state.wizardDraftValue) ? state.wizardDraftValue : [];
    return html`
      ${step.message ? html`<div class="wizard-step-message">${step.message}</div>` : nothing}
      <div class="wizard-option-list" style="margin-top: 14px;">
        ${options.map(
          (option) => html`
            <button
              class="wizard-option ${wizardArrayIncludes(current, option.value) ? "active" : ""}"
              @click=${() =>
                state.handleUpdateSetupWizardDraft(toggleWizardMultiValue(current, option.value))}
            >
              <div class="wizard-option__label">${option.label}</div>
              ${option.hint
                ? html`<div class="wizard-option__hint">${option.hint}</div>`
                : nothing}
            </button>
          `,
        )}
      </div>
    `;
  }
  return html`${step.message ? html`<div class="wizard-step-message">${step.message}</div>` : nothing}`;
}

function resolveWizardActionLabel(state: AppViewState): string {
  if (!state.wizardStep) {
    return t("common.close");
  }
  return state.wizardStep.type === "note" ? t("common.continue") : t("wizard.submit");
}

function renderWizardBody(state: AppViewState) {
  if (state.wizardLoading) {
    return html`<div class="wizard-empty">${t("wizard.loading")}</div>`;
  }

  if (state.wizardStep) {
    return html`
      <div class="wizard-step">
        ${state.wizardStep.title
          ? html`<div class="wizard-step-title">${state.wizardStep.title}</div>`
          : nothing}
        ${renderWizardStep(state.wizardStep, state)}
      </div>
    `;
  }

  if (state.wizardStatus === "done") {
    return html`<div class="wizard-empty">${t("wizard.doneMessage")}</div>`;
  }
  if (state.wizardStatus === "cancelled") {
    return html`<div class="wizard-empty">${t("wizard.cancelledMessage")}</div>`;
  }
  if (state.wizardStatus === "error") {
    return html`<div class="wizard-empty">${t("wizard.errorMessage")}</div>`;
  }
  return html`<div class="wizard-empty">${t("wizard.waiting")}</div>`;
}

export function renderSetupWizard(state: AppViewState) {
  if (!state.wizardOpen) {
    return nothing;
  }

  const isTerminalState =
    state.wizardStatus === "done" ||
    state.wizardStatus === "cancelled" ||
    state.wizardStatus === "error";
  const statusLabel =
    state.wizardStatus != null ? t(`wizard.status.${state.wizardStatus}`) : t("wizard.status.running");

  return html`
    <div class="exec-approval-overlay" role="dialog" aria-modal="true" aria-live="polite">
      <div class="exec-approval-card wizard-card">
        <div class="exec-approval-header">
          <div>
            <div class="exec-approval-title">${t("wizard.title")}</div>
            <div class="exec-approval-sub">
              ${state.wizardMode === "remote" ? t("wizard.modeRemote") : t("wizard.modeLocal")}
            </div>
          </div>
          <span
            class="chip ${state.wizardStatus === "error"
              ? "chip-danger"
              : state.wizardStatus === "done"
                ? "chip-ok"
                : state.wizardStatus === "cancelled"
                  ? "chip-warn"
                  : ""}"
            >${statusLabel}</span
          >
        </div>

        ${state.wizardError
          ? html`<div class="callout danger" style="margin-top: 14px;">${state.wizardError}</div>`
          : nothing}

        ${renderWizardBody(state)}

        <div class="exec-approval-actions wizard-actions">
          ${isTerminalState
            ? html`<button class="btn primary" @click=${() => state.handleDismissSetupWizard()}>
                ${t("common.close")}
              </button>`
            : html`
                <button
                  class="btn"
                  ?disabled=${state.wizardLoading || state.wizardBusy}
                  @click=${() => void state.handleCancelSetupWizard()}
                >
                  ${t("common.cancel")}
                </button>
                <button
                  class="btn primary"
                  ?disabled=${state.wizardLoading || state.wizardBusy}
                  @click=${() => void state.handleSubmitSetupWizard()}
                >
                  ${state.wizardBusy ? t("wizard.submitting") : resolveWizardActionLabel(state)}
                </button>
              `}
        </div>
      </div>
    </div>
  `;
}
