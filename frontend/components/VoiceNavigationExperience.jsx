import React, { useEffect, useRef, useState } from "react";
import {
  VoiceNavigationOrchestrator,
  VOICE_NAV_STATES
} from "../utils/voiceNavigation/VoiceNavigationOrchestrator.js";
import { useLanguage } from "../utils/LanguageContext.jsx";

export function VoiceNavigationExperience({
  speakText,
  speechSupported,
  onEnableListening,
  onDisableListening,
  isListening,
  isSpeakingRef,
  orchestratorDeps,
  onSessionChange,
  onOrchestratorReady
}) {
  const { t, setLanguage } = useLanguage();
  const orchestratorRef = useRef(null);
  const [voiceNavState, setVoiceNavState] = useState(VOICE_NAV_STATES.IDLE);
  const [sessionActive, setSessionActive] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [textFallback, setTextFallback] = useState("");

  useEffect(() => {
    orchestratorRef.current = new VoiceNavigationOrchestrator({
      ...orchestratorDeps,
      setLanguage: (code) => setLanguage(code),
      speak: (text, meta) => speakText(text, meta?.customLang),
      isSpeaking: () => isSpeakingRef?.current,
      onStateChange: ({ state, sessionActive: active, error }) => {
        setVoiceNavState(state);
        setSessionActive(!!active);
        onSessionChange?.({ state, sessionActive: !!active });
        if (error) setStatusMessage(error);
      },
      startListening: () => onEnableListening?.(),
      stopListening: (user) => onDisableListening?.(user)
    });
    onOrchestratorReady?.(orchestratorRef.current);
  }, [orchestratorDeps, speakText, onEnableListening, onDisableListening, isSpeakingRef, onSessionChange, onOrchestratorReady, setLanguage]);

  const enableVoiceNavigation = async () => {
    setStatusMessage("");
    if (!speechSupported) {
      setStatusMessage(t("messages.sttNotSupported"));
      return;
    }
    const ok = await orchestratorRef.current?.enableSession();
    if (ok) {
      setStatusMessage(t("messages.voiceControlEnabled"));
    }
  };

  const disableVoiceNavigation = () => {
    orchestratorRef.current?.disableSession();
    setStatusMessage(t("messages.voiceControlDisabled"));
  };

  const submitTextFallback = async () => {
    const text = textFallback.trim();
    if (!text) return;
    if (!sessionActive) {
      await enableVoiceNavigation();
    }
    await orchestratorRef.current?.processTranscript(text);
    setTextFallback("");
  };

  const repeatOnboarding = () => {
    speakText(t("messages.onboarding"));
  };

  const stateLabels = {
    [VOICE_NAV_STATES.IDLE]: t("state_idle"),
    [VOICE_NAV_STATES.AWAITING_PERMISSION]: t("state_awaiting_permission"),
    [VOICE_NAV_STATES.LISTENING]: t("state_listening"),
    [VOICE_NAV_STATES.PROCESSING]: t("state_processing"),
    [VOICE_NAV_STATES.CONFIRMING_DESTINATION]: t("state_confirming_destination"),
    [VOICE_NAV_STATES.DETERMINING_LOCATION]: t("state_determining_location"),
    [VOICE_NAV_STATES.PLANNING_ROUTE]: t("state_planning_route"),
    [VOICE_NAV_STATES.NAVIGATING]: t("state_navigating"),
    [VOICE_NAV_STATES.PAUSED]: t("state_paused"),
    [VOICE_NAV_STATES.ERROR]: t("state_error")
  };

  const currentLabel = stateLabels[voiceNavState] || voiceNavState;

  return (
    <section className="feature-card voice-nav-entry" aria-label={t("voice_nav_experience_title")}>
      <div className="card-header">
        <div className="card-icon" aria-hidden="true">
          🎧
        </div>
        <div>
          <h2 className="card-title">{t("voice_nav_experience_title")}</h2>
          <p style={{ color: "rgba(255, 255, 255, 0.65)", fontSize: "0.95rem", marginTop: 4 }}>
            {t("voice_nav_experience_subtitle")}
          </p>
        </div>
      </div>

      <p className="voice-nav-perms" role="note">
        {t("voice_nav_perms_note")}
      </p>

      <div className="indoor-btn-row" style={{ display: "flex", flexWrap: "wrap", gap: "10px", marginTop: "12px" }}>
        {!sessionActive ? (
          <button
            type="button"
            className="primary-btn success-btn"
            onClick={enableVoiceNavigation}
            aria-label={t("enable_voice_nav")}
            id="start-voice-nav-btn"
          >
            {t("enable_voice_nav")}
          </button>
        ) : (
          <button
            type="button"
            className="primary-btn danger-btn"
            onClick={disableVoiceNavigation}
            aria-label={t("end_voice_nav")}
          >
            {t("end_voice_nav")}
          </button>
        )}
        <button
          type="button"
          className="primary-btn accent-btn"
          onClick={repeatOnboarding}
          aria-label={t("repeat_onboarding")}
        >
          {t("repeat_onboarding")}
        </button>
      </div>

      <div
        className="result-box"
        style={{ marginTop: 14, borderColor: "#667eea" }}
        aria-live="polite"
        role="status"
      >
        <div className="result-title">
          {t("voice_session_status")}: {currentLabel}
        </div>
        <div className="result-content">
          {t("mic_status")}:{" "}
          <strong>
            {isListening ? t("mic_listening") : sessionActive ? t("mic_waiting") : t("mic_off")}
          </strong>
          {statusMessage ? ` — ${statusMessage}` : ""}
        </div>
      </div>

      <div style={{ marginTop: 14 }}>
        <label htmlFor="voice-text-fallback" style={{ display: "block", marginBottom: "6px", fontWeight: "600" }}>
          {t("text_fallback_label")}
        </label>
        <div className="nav-input-row">
          <input
            id="voice-text-fallback"
            className="nav-input"
            placeholder={t("text_fallback_placeholder")}
            value={textFallback}
            onChange={(e) => setTextFallback(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitTextFallback()}
            aria-label={t("text_fallback_label")}
          />
          <button type="button" className="primary-btn" onClick={submitTextFallback} aria-label={t("send")}>
            {t("send")}
          </button>
        </div>
      </div>
    </section>
  );
}

export default VoiceNavigationExperience;
