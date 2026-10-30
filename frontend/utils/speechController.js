// frontend/utils/speechController.js
import { parseNavigationUtterance } from "./voiceNavigation/voiceCommandParser.js";

export const VOICE_CONTROLLER_STATES = {
  IDLE: "idle",
  REQUESTING_PERMISSION: "requesting_permission",
  LISTENING: "listening",
  PROCESSING_COMMAND: "processing_command",
  SPEAKING: "speaking",
  PAUSED: "paused",
  ERROR: "error"
};

export const SPEECH_ERROR_CODES = {
  UNSUPPORTED_BROWSER: "UNSUPPORTED_BROWSER",
  INSECURE_CONTEXT: "INSECURE_CONTEXT",
  PERMISSION_DENIED: "PERMISSION_DENIED",
  NO_DEVICE: "NO_DEVICE",
  DEVICE_BUSY: "DEVICE_BUSY",
  CONNECTION_LOST: "CONNECTION_LOST",
  INIT_FAILED: "INIT_FAILED"
};

/**
 * Detects if the current client is a mobile device or touch-first environment.
 */
export function isMobileEnvironment() {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || navigator.vendor || window.opera || "";
  const mobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
  const touchPoints = navigator.maxTouchPoints > 0;
  const narrowScreen = window.innerWidth <= 768;
  return mobileUA || (touchPoints && narrowScreen);
}

export class SpeechController {
  constructor({
    onCommand,
    onTranscript,
    onStateChange,
    onError,
    getLanguage,
    isSpeakingRef,
    getVoiceNavActive,
    onVoiceNavTranscript,
    onUnknownCommand
  }) {
    this.onCommand = onCommand || (() => {});
    this.onTranscript = onTranscript || (() => {});
    this.onStateChange = onStateChange || (() => {});
    this.onError = onError || (() => {});
    this.getLanguage = getLanguage || (() => "en-US");
    this.isSpeakingRef = isSpeakingRef || { current: false };
    this.getVoiceNavActive = getVoiceNavActive || (() => false);
    this.onVoiceNavTranscript = onVoiceNavTranscript || (() => {});
    this.onUnknownCommand = onUnknownCommand || null;

    this.state = VOICE_CONTROLLER_STATES.IDLE;
    this.recognition = null;
    this.isListeningIntentional = false;
    this.isListening = false;
    this.isStarting = false;
    this.lastCommandTime = 0;
    this.commandDebounceMs = 1200;
    this.restartTimeout = null;
    this.consecutiveRestartFailures = 0;
    this.lastStartTimestamp = 0;
    this.maxConsecutiveFailures = 8;
  }

  /**
   * Checks whether the browser supports the Web Speech Recognition API.
   */
  isSupported() {
    return typeof window !== "undefined" && !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  }

  /**
   * Checks whether the current window context is secure (HTTPS or localhost).
   */
  isSecureContext() {
    if (typeof window === "undefined") return true;
    return !!window.isSecureContext || window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
  }

  setState(nextState, extra = {}) {
    this.state = nextState;
    this.isListening = nextState === VOICE_CONTROLLER_STATES.LISTENING;
    this.onStateChange({
      state: nextState,
      isListening: this.isListening,
      intentional: this.isListeningIntentional,
      ...extra
    });
  }

  /**
   * Queries navigator.permissions for microphone access without opening audio streams.
   */
  async checkPermissionStatus() {
    if (typeof navigator !== "undefined" && navigator.permissions?.query) {
      try {
        const result = await navigator.permissions.query({ name: "microphone" });
        if (result && !result.onchange) {
          result.onchange = () => {
            console.log("[SpeechController] Microphone permission changed to:", result.state);
            this.setState(this.state, { permissionState: result.state });
          };
        }
        return result.state; // 'granted', 'denied', 'prompt'
      } catch {
        return "unknown";
      }
    }
    return "unknown";
  }

  /**
   * Requests microphone access using getUserMedia solely when permission is unprompted.
   * Immediately stops and releases all audio tracks upon check.
   */
  async requestMicrophonePermission() {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      return { ok: false, reason: "no_media_devices" };
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Immediately stop and release all audio tracks
      stream.getTracks().forEach((track) => track.stop());
      return { ok: true };
    } catch (err) {
      console.warn("[SpeechController] getUserMedia diagnostic result:", err.name, err.message);
      if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
        return { ok: false, reason: "permission_denied" };
      }
      if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
        return { ok: false, reason: "no_device" };
      }
      if (err.name === "NotReadableError" || err.name === "TrackStartError") {
        return { ok: false, reason: "device_busy" };
      }
      return { ok: false, reason: "media_error" };
    }
  }

  /**
   * Initiates hands-free speech recognition with clean feature and permission checks.
   * Returns { success: boolean, reason?: string, userMessage?: string }
   */
  async startListening(requestPermission = false) {
    // 1. Feature Detection: Does browser support Web Speech API?
    if (!this.isSupported()) {
      const userMessage = "Speech recognition is not supported in this browser. Please use Chrome on Android, Chrome/Edge on desktop, or Safari.";
      this.setState(VOICE_CONTROLLER_STATES.ERROR, { error: userMessage });
      this.onError({
        code: SPEECH_ERROR_CODES.UNSUPPORTED_BROWSER,
        message: "Speech recognition not supported in this browser.",
        userMessage,
        spokenMessage: "Speech recognition is not supported in this browser. You can type commands below."
      });
      return { success: false, reason: "unsupported_browser", userMessage };
    }

    // 2. Secure Context Detection: Is context HTTPS or localhost?
    if (!this.isSecureContext()) {
      const userMessage = "Microphone access requires a secure HTTPS connection.";
      this.setState(VOICE_CONTROLLER_STATES.ERROR, { error: userMessage });
      this.onError({
        code: SPEECH_ERROR_CODES.INSECURE_CONTEXT,
        message: "Insecure HTTP context.",
        userMessage,
        spokenMessage: "Microphone access requires a secure connection."
      });
      return { success: false, reason: "insecure_context", userMessage };
    }

    // 3. Permission check
    const permState = await this.checkPermissionStatus();
    if (permState === "denied") {
      const userMessage = "Microphone access is blocked in your browser settings. Please allow microphone permissions.";
      this.setState(VOICE_CONTROLLER_STATES.ERROR, { error: userMessage });
      this.onError({
        code: SPEECH_ERROR_CODES.PERMISSION_DENIED,
        message: "Microphone permission denied by user/browser.",
        userMessage,
        spokenMessage: "Please enable microphone access to use voice commands."
      });
      return { success: false, reason: "permission_denied", userMessage };
    }

    // 4. If permission is prompt or unknown, and user gesture is present, request permission via getUserMedia
    if (requestPermission && permState !== "granted" && typeof navigator !== "undefined" && navigator.mediaDevices?.getUserMedia) {
      const micResult = await this.requestMicrophonePermission();
      if (!micResult.ok) {
        if (micResult.reason === "permission_denied") {
          const userMessage = "Microphone access was denied. Please allow microphone permissions in site settings.";
          this.setState(VOICE_CONTROLLER_STATES.ERROR, { error: userMessage });
          this.onError({
            code: SPEECH_ERROR_CODES.PERMISSION_DENIED,
            message: "Microphone permission denied.",
            userMessage,
            spokenMessage: "Please enable microphone access to use voice commands."
          });
          return { success: false, reason: "permission_denied", userMessage };
        }
        if (micResult.reason === "no_device") {
          const userMessage = "No microphone was found on this device.";
          this.setState(VOICE_CONTROLLER_STATES.ERROR, { error: userMessage });
          this.onError({
            code: SPEECH_ERROR_CODES.NO_DEVICE,
            message: "No microphone detected on device.",
            userMessage,
            spokenMessage: userMessage
          });
          return { success: false, reason: "no_device", userMessage };
        }
        if (micResult.reason === "device_busy") {
          const userMessage = "Microphone is currently in use by another application.";
          this.setState(VOICE_CONTROLLER_STATES.ERROR, { error: userMessage });
          this.onError({
            code: SPEECH_ERROR_CODES.DEVICE_BUSY,
            message: "Microphone locked by another app.",
            userMessage,
            spokenMessage: userMessage
          });
          return { success: false, reason: "device_busy", userMessage };
        }
      }
    }

    this.isListeningIntentional = true;
    this.consecutiveRestartFailures = 0;
    this.setState(VOICE_CONTROLLER_STATES.REQUESTING_PERMISSION);

    const started = this._initiateRecognition();
    if (started) {
      return { success: true };
    } else {
      return { success: false, reason: "init_failed", userMessage: "Voice assistance is temporarily unavailable. Please try again." };
    }
  }

  _initiateRecognition() {
    if (!this.isListeningIntentional) return false;
    if (this.isStarting) return false;

    // Bounded retries: halt retry loop if consecutive failures exceed threshold
    if (this.consecutiveRestartFailures >= this.maxConsecutiveFailures) {
      console.warn(`[SpeechController] Exceeded maximum restart attempts (${this.maxConsecutiveFailures}). Halting retry loop.`);
      this.isListeningIntentional = false;
      this.isStarting = false;
      const userMessage = "Voice recognition paused after repeated connection drops. Tap to resume.";
      this.setState(VOICE_CONTROLLER_STATES.ERROR, { error: userMessage });
      this.onError({
        code: SPEECH_ERROR_CODES.CONNECTION_LOST,
        message: "Repeated speech connection drops.",
        userMessage,
        spokenMessage: "Voice assistance is temporarily unavailable. Please try again."
      });
      return false;
    }

    // Clean up any existing recognition session before creating a new one
    if (this.recognition) {
      try {
        this.recognition.onstart = null;
        this.recognition.onresult = null;
        this.recognition.onerror = null;
        this.recognition.onend = null;
        this.recognition.abort();
      } catch {
        /* ignore abort error */
      }
      this.recognition = null;
    }

    this.isStarting = true;

    try {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      this.recognition = new SpeechRecognition();
      this.recognition.continuous = true;
      this.recognition.interimResults = false;
      this.recognition.maxAlternatives = 1;
      this.recognition.lang = this.getLanguage();

      this.recognition.onstart = () => {
        this.isStarting = false;
        this.lastStartTimestamp = Date.now();
        this.consecutiveRestartFailures = 0;
        this.setState(VOICE_CONTROLLER_STATES.LISTENING);
      };

      this.recognition.onresult = (event) => {
        // Drop transcript if currently speaking TTS to prevent audio feedback loop
        const isActuallySpeaking =
          this.state === VOICE_CONTROLLER_STATES.SPEAKING ||
          (this.isSpeakingRef && this.isSpeakingRef.current) ||
          (typeof window !== "undefined" && window.speechSynthesis && window.speechSynthesis.speaking);

        if (isActuallySpeaking) {
          console.log("[SpeechController] Suppressing audio transcript during active speech playback.");
          return;
        }

        const results = event.results;
        if (!results || results.length === 0) return;

        const latestResult = results[results.length - 1];
        if (latestResult.isFinal || latestResult[0]?.transcript) {
          const transcript = latestResult[0].transcript.trim();
          if (transcript) {
            this.onTranscript(transcript);
            this.handleTranscript(transcript);
          }
        }
      };

      this.recognition.onerror = (event) => {
        this.isStarting = false;
        const errorType = event.error;

        if (errorType === "not-allowed" || errorType === "service-not-allowed") {
          console.warn("[SpeechController] Microphone permission denied:", errorType);
          this.isListeningIntentional = false;
          const userMessage = "Microphone access is blocked in your browser settings. Please allow microphone permissions.";
          this.setState(VOICE_CONTROLLER_STATES.ERROR, { error: userMessage });
          this.onError({
            code: SPEECH_ERROR_CODES.PERMISSION_DENIED,
            message: errorType,
            userMessage,
            spokenMessage: "Please enable microphone access to use voice commands."
          });
          return;
        }

        if (errorType === "no-speech" || errorType === "aborted") {
          // Normal silence timeout or intentional abort during speaking/pause. Handled smoothly in onend.
          return;
        }

        if (errorType === "audio-capture") {
          this.isListeningIntentional = false;
          const userMessage = "Microphone disconnected or unavailable.";
          this.setState(VOICE_CONTROLLER_STATES.ERROR, { error: userMessage });
          this.onError({
            code: SPEECH_ERROR_CODES.NO_DEVICE,
            message: "Audio capture failed",
            userMessage,
            spokenMessage: "No microphone was found on this device."
          });
          return;
        }

        if (errorType === "network") {
          console.warn("[SpeechController] Network speech service error:", errorType);
          this.consecutiveRestartFailures += 1;
          // onend will handle backoff delay without spamming the user
          return;
        }

        console.warn("[SpeechController] Recognition error:", errorType);
      };

      this.recognition.onend = () => {
        this.isStarting = false;
        this.recognition = null;

        if (!this.isListeningIntentional) {
          this.setState(VOICE_CONTROLLER_STATES.IDLE);
          return;
        }

        // If currently speaking TTS or paused, recognition will be re-armed when speech completes
        if (
          this.state === VOICE_CONTROLLER_STATES.SPEAKING ||
          this.state === VOICE_CONTROLLER_STATES.PAUSED ||
          (this.isSpeakingRef && this.isSpeakingRef.current)
        ) {
          return;
        }

        // Calculate restart delay with backoff against runaway loops
        const elapsedSinceStart = Date.now() - (this.lastStartTimestamp || 0);
        if (elapsedSinceStart < 1200) {
          this.consecutiveRestartFailures += 1;
        } else {
          this.consecutiveRestartFailures = 0;
        }

        if (this.consecutiveRestartFailures >= this.maxConsecutiveFailures) {
          console.warn("[SpeechController] Too many quick restarts in onend. Halting retry loop.");
          this.isListeningIntentional = false;
          const userMessage = "Voice recognition paused. Tap to resume voice assistance.";
          this.setState(VOICE_CONTROLLER_STATES.ERROR, { error: userMessage });
          this.onError({
            code: SPEECH_ERROR_CODES.CONNECTION_LOST,
            message: "Repeated restarts in onend",
            userMessage,
            spokenMessage: "Voice assistance is temporarily unavailable. Please try again."
          });
          return;
        }

        let restartDelayMs = 350;
        if (this.consecutiveRestartFailures > 4) {
          restartDelayMs = 2500; // Back off
        } else if (this.consecutiveRestartFailures > 2) {
          restartDelayMs = 1000;
        }

        if (this.restartTimeout) clearTimeout(this.restartTimeout);
        this.restartTimeout = setTimeout(() => {
          if (
            this.isListeningIntentional &&
            this.state !== VOICE_CONTROLLER_STATES.SPEAKING &&
            !(this.isSpeakingRef && this.isSpeakingRef.current)
          ) {
            this._initiateRecognition();
          }
        }, restartDelayMs);
      };

      this.recognition.start();
      return true;
    } catch (err) {
      this.isStarting = false;
      this.consecutiveRestartFailures += 1;
      console.warn("[SpeechController] Failed to start recognition:", err);
      if (this.isListeningIntentional && this.state !== VOICE_CONTROLLER_STATES.SPEAKING) {
        if (this.consecutiveRestartFailures >= this.maxConsecutiveFailures) {
          this.isListeningIntentional = false;
          const userMessage = "Voice assistance is temporarily unavailable. Please tap to try again.";
          this.setState(VOICE_CONTROLLER_STATES.ERROR, { error: userMessage });
          this.onError({
            code: SPEECH_ERROR_CODES.INIT_FAILED,
            message: err.message,
            userMessage,
            spokenMessage: userMessage
          });
          return false;
        }

        if (this.restartTimeout) clearTimeout(this.restartTimeout);
        this.restartTimeout = setTimeout(() => {
          if (this.isListeningIntentional && this.state !== VOICE_CONTROLLER_STATES.SPEAKING) {
            this._initiateRecognition();
          }
        }, 1200);
      }
      return false;
    }
  }

  onSpeakingStart() {
    this.setState(VOICE_CONTROLLER_STATES.SPEAKING);
    if (this.restartTimeout) {
      clearTimeout(this.restartTimeout);
      this.restartTimeout = null;
    }
    if (this.recognition) {
      try {
        this.recognition.abort();
      } catch {
        /* ignore */
      }
    }
  }

  onSpeakingEnd() {
    if (this.isListeningIntentional) {
      if (this.restartTimeout) clearTimeout(this.restartTimeout);
      // Wait 350ms for room echo / speaker reverberation to dissipate
      this.restartTimeout = setTimeout(() => {
        if (this.isListeningIntentional && !(this.isSpeakingRef && this.isSpeakingRef.current)) {
          this._initiateRecognition();
        }
      }, 350);
    }
  }

  pauseListening() {
    this.setState(VOICE_CONTROLLER_STATES.PAUSED);
    if (this.restartTimeout) {
      clearTimeout(this.restartTimeout);
      this.restartTimeout = null;
    }
    if (this.recognition) {
      try {
        this.recognition.abort();
      } catch {
        /* ignore */
      }
    }
  }

  resumeListening() {
    if (this.isListeningIntentional) {
      this._initiateRecognition();
    }
  }

  stopListening(userInitiated = true) {
    if (userInitiated) {
      this.isListeningIntentional = false;
    }
    if (this.restartTimeout) {
      clearTimeout(this.restartTimeout);
      this.restartTimeout = null;
    }
    if (this.recognition) {
      try {
        this.recognition.onstart = null;
        this.recognition.onresult = null;
        this.recognition.onerror = null;
        this.recognition.onend = null;
        this.recognition.abort();
      } catch {
        /* ignore */
      }
      this.recognition = null;
    }
    this.setState(VOICE_CONTROLLER_STATES.IDLE);
  }

  setLanguage(langCode) {
    if (this.recognition) {
      this.recognition.lang = langCode;
    }
  }

  handleTranscript(rawTranscript) {
    const now = Date.now();
    if (now - this.lastCommandTime < this.commandDebounceMs) {
      return; // Debounce rapid triggers
    }

    // Double check that we are not currently speaking TTS before processing
    if (
      this.state === VOICE_CONTROLLER_STATES.SPEAKING ||
      (this.isSpeakingRef && this.isSpeakingRef.current) ||
      (typeof window !== "undefined" && window.speechSynthesis && window.speechSynthesis.speaking)
    ) {
      console.log("[SpeechController] Suppressing transcript received while TTS speaking active.");
      return;
    }

    this.setState(VOICE_CONTROLLER_STATES.PROCESSING_COMMAND);
    const command = this.parseCommand(rawTranscript);

    this.lastCommandTime = now;

    if (!command || command.type === "UNKNOWN") {
      if (this.onUnknownCommand) {
        this.onUnknownCommand(rawTranscript);
      } else {
        this.onCommand({ type: "UNKNOWN" }, rawTranscript);
      }
      return;
    }

    this.onCommand(command, rawTranscript);

    // If an ongoing voice navigation session is active, also notify the orchestrator
    if (this.getVoiceNavActive()) {
      this.onVoiceNavTranscript(rawTranscript);
    }
  }

  parseCommand(rawTranscript) {
    return parseNavigationUtterance(rawTranscript);
  }
}
