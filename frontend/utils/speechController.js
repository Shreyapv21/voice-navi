// frontend/utils/speechController.js
import { parseNavigationUtterance } from "./voiceNavigation/voiceCommandParser.js";

export class SpeechController {
  constructor({
    onCommand,
    onTranscript,
    onStateChange,
    onError,
    getLanguage,
    isSpeakingRef,
    getVoiceNavActive,
    onVoiceNavTranscript
  }) {
    this.onCommand = onCommand || (() => {});
    this.onTranscript = onTranscript || (() => {});
    this.onStateChange = onStateChange || (() => {});
    this.onError = onError || (() => {});
    this.getLanguage = getLanguage || (() => "en-US");
    this.isSpeakingRef = isSpeakingRef || { current: false };
    this.getVoiceNavActive = getVoiceNavActive || (() => false);
    this.onVoiceNavTranscript = onVoiceNavTranscript || (() => {});

    this.recognition = null;
    this.isListeningIntentional = false;
    this.isListening = false;
    this.lastCommandTime = 0;
    this.commandDebounceMs = 1500;
    this.restartTimeout = null;
  }

  isSupported() {
    return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  }

  startListening() {
    if (!this.isSupported()) {
      this.onError("Speech recognition not supported in this browser.");
      return false;
    }

    this.isListeningIntentional = true;

    // Clean up any existing instance to guarantee strictly ONE active instance
    this.stopListening(false);

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.recognition = new SpeechRecognition();
    this.recognition.continuous = true;
    this.recognition.interimResults = false;
    this.recognition.maxAlternatives = 1;
    this.recognition.lang = this.getLanguage();

    this.recognition.onstart = () => {
      this.isListening = true;
      this.onStateChange({ isListening: true, intentional: true });
    };

    this.recognition.onresult = (event) => {
      // Prevent feedback loops if TTS is actively speaking
      const isActuallySpeaking =
        this.isSpeakingRef.current && typeof window !== "undefined" && window.speechSynthesis?.speaking;
      if (isActuallySpeaking) {
        console.log("Ignoring speech input during TTS playback.");
        return;
      }
      // If speechSynthesis is not actually speaking, ensure speaking ref is cleared
      if (this.isSpeakingRef.current && typeof window !== "undefined" && !window.speechSynthesis?.speaking) {
        this.isSpeakingRef.current = false;
      }

      const results = event.results;
      if (!results || results.length === 0) return;

      const latestResult = results[results.length - 1];
      if (latestResult.isFinal || latestResult[0]?.transcript) {
        const transcript = latestResult[0].transcript.trim();
        this.onTranscript(transcript);
        this.handleTranscript(transcript);
      }
    };

    this.recognition.onerror = (event) => {
      const errorType = event.error;

      if (errorType === "not-allowed" || errorType === "service-not-allowed") {
        console.warn("Speech recognition error:", errorType);
        this.isListeningIntentional = false;
        this.isListening = false;
        this.onStateChange({ isListening: false, intentional: false });
        this.onError("Microphone permission denied.");
        return;
      }

      if (errorType === "no-speech" || errorType === "aborted") {
        // Normal silence timeout or aborted restart; do not trigger error loop or noisy logs
        return;
      }

      console.warn("Speech recognition error:", errorType);
      // Non-fatal error notification
      this.onError(`Voice recognition: ${errorType}`);
    };

    this.recognition.onend = () => {
      this.isListening = false;
      this.onStateChange({ isListening: false, intentional: this.isListeningIntentional });

      // Only restart if the user intentionally enabled listening,
      // and we are not speaking TTS, and not in an error state
      if (this.isListeningIntentional) {
        if (this.restartTimeout) clearTimeout(this.restartTimeout);
        this.restartTimeout = setTimeout(() => {
          if (this.isListeningIntentional && !this.isSpeakingRef.current) {
            try {
              if (this.recognition) {
                this.recognition.lang = this.getLanguage();
                this.recognition.start();
              }
            } catch (err) {
              console.warn("Failed to restart speech recognition:", err);
            }
          }
        }, 500);
      }
    };

    try {
      this.recognition.start();
      return true;
    } catch (err) {
      console.error("Error starting speech recognition:", err);
      this.isListeningIntentional = false;
      this.isListening = false;
      this.onStateChange({ isListening: false, intentional: false });
      return false;
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
        this.recognition.onend = null;
        this.recognition.onerror = null;
        this.recognition.onresult = null;
        this.recognition.stop();
      } catch (err) {
        console.warn("Error stopping recognition:", err);
      }
      this.recognition = null;
    }
    this.isListening = false;
    this.onStateChange({ isListening: false, intentional: this.isListeningIntentional });
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

    const command = this.parseCommand(rawTranscript);
    if (!command || command.type === "UNKNOWN") {
      return;
    }

    this.lastCommandTime = now;
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
