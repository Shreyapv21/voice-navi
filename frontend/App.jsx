// frontend/App.jsx
import React, { useState, useEffect, useRef } from "react";
import {
  SUPPORTED_LANGUAGES,
  DEFAULT_LANGUAGE,
  getMessage,
  translateObjectLabel,
  translateDirection,
  formatDetectionSentence,
  translateInstructionText
} from "./utils/languages";
import { LanguageProvider, useLanguage } from "./utils/LanguageContext.jsx";
import { SpeechController } from "./utils/speechController";
import { NavigationManager, formatDistance, formatDuration } from "./utils/navigationManager";
import { IndoorNavigationPanel } from "./components/IndoorNavigationPanel.jsx";
import { VoiceNavigationExperience } from "./components/VoiceNavigationExperience.jsx";
import { OutdoorMap } from "./components/OutdoorMap.jsx";
import { IndoorNavigationManager } from "./utils/indoor/indoorNavigationManager.js";

const backendURL = "";

function AppContent() {
  const { t, language, setLanguage } = useLanguage();

  // ---------------- Core Feature States ----------------
  const [ocrResult, setOcrResult] = useState("");
  const [objectResult, setObjectResult] = useState([]);
  const [sttResult, setSttResult] = useState("");
  const [ttsText, setTtsText] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [activeTab, setActiveTab] = useState("home");

  // ---------------- Live Detection States ----------------
  const [detectionState, setDetectionState] = useState("CAMERA_OFF");
  const [liveDetections, setLiveDetections] = useState([]);
  const [cameraError, setCameraError] = useState("");

  // ---------------- Voice Command / STT Control State ----------------
  const [isVoiceControlActive, setIsVoiceControlActive] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState("");
  const [lastExecutedCommand, setLastExecutedCommand] = useState("");
  const [speechError, setSpeechError] = useState("");

  // ---------------- Navigation State ----------------
  const [navigationState, setNavigationState] = useState({
    isNavigating: false,
    status: "IDLE", // IDLE | RESOLVING | ACTIVE | ARRIVED | STOPPED | ERROR | UNCONFIGURED
    destination: null,
    formattedDistance: "",
    formattedDuration: "",
    currentStep: null,
    steps: [],
    currentStepIndex: 0,
    routeData: null,
    errorMessage: ""
  });
  const [manualDestination, setManualDestination] = useState("");
  const [navigationMode, setNavigationMode] = useState("outdoor"); // outdoor | indoor
  const [indoorUiSync, setIndoorUiSync] = useState(null);
  const [voiceNavSessionActive, setVoiceNavSessionActive] = useState(false);
  const [userLocation, setUserLocation] = useState(null);

  // ---------------- Refs for Hardware & Singletons ----------------
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const pollIntervalRef = useRef(null);
  const isProcessingFrameRef = useRef(false);
  const isSpeakingRef = useRef(false);
  const latestDetectionsRef = useRef([]);

  // Smart announcement throttling refs
  const lastSpokenObjectsRef = useRef({});
  const lastGlobalAnnouncementRef = useRef(0);

  // Speech & Navigation controller refs
  const speechControllerRef = useRef(null);
  const navigationManagerRef = useRef(null);
  const indoorNavigationManagerRef = useRef(null);
  const voiceOrchestratorRef = useRef(null);
  const voiceNavSessionActiveRef = useRef(false);
  const navigationModeRef = useRef(navigationMode);
  navigationModeRef.current = navigationMode;
  voiceNavSessionActiveRef.current = voiceNavSessionActive;

  const selectedLanguageRef = useRef(language);
  selectedLanguageRef.current = language;

  const handleVoiceCommandRef = useRef(null);
  const toggleVoiceControlRef = useRef(null);
  const slamControlRef = useRef(null);
  const activeUtteranceRef = useRef(null);
  const ttsSafetyTimeoutRef = useRef(null);
  const activeInstructionRef = useRef(null);
  const interruptedInstructionRef = useRef(null);
  const navigationStateRef = useRef(navigationState);
  navigationStateRef.current = navigationState;
  const speakTextRef = useRef(null);
  const startLiveDetectionRef = useRef(null);
  const pauseLiveDetectionRef = useRef(null);
  const resumeLiveDetectionRef = useRef(null);
  const stopLiveDetectionRef = useRef(null);

  const currentAudioRef = useRef(null);
  const currentTtsAbortControllerRef = useRef(null);

  // ---------------- Helper: Text to Speech with Voice Selection & Neural TTS Fallback ----------------
  const speakText = (text, customLang = null, options = {}) => {
    if (!text || typeof window === "undefined") return;

    if (ttsSafetyTimeoutRef.current) {
      clearTimeout(ttsSafetyTimeoutRef.current);
      ttsSafetyTimeoutRef.current = null;
    }

    // Cancel any in-flight server TTS fetch
    if (currentTtsAbortControllerRef.current) {
      try {
        currentTtsAbortControllerRef.current.abort();
      } catch {
        /* ignore abort error */
      }
      currentTtsAbortControllerRef.current = null;
    }

    // Stop any playing audio
    if (currentAudioRef.current) {
      try {
        currentAudioRef.current.pause();
        currentAudioRef.current.currentTime = 0;
        currentAudioRef.current.src = "";
      } catch {
        /* ignore audio stop error */
      }
      currentAudioRef.current = null;
    }

    if (window.speechSynthesis) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        /* ignore cancel error */
      }
    }
    isSpeakingRef.current = false;

    // If an obstacle alert interrupts an in-progress route instruction, save it to resume afterwards
    if (options.isObstacle && isSpeakingRef.current && activeInstructionRef.current) {
      interruptedInstructionRef.current = activeInstructionRef.current;
    }
    if (options.isInstruction) {
      activeInstructionRef.current = text;
    }

    const lang = customLang || selectedLanguageRef.current || "en-US";
    const langPrefix = lang.split("-")[0].toLowerCase();

    const cleanupSpeaking = () => {
      if (ttsSafetyTimeoutRef.current) {
        clearTimeout(ttsSafetyTimeoutRef.current);
        ttsSafetyTimeoutRef.current = null;
      }
      isSpeakingRef.current = false;
      activeUtteranceRef.current = null;
      currentAudioRef.current = null;

      if (options.isInstruction && activeInstructionRef.current === text) {
        activeInstructionRef.current = null;
      }

      // Resume interrupted route instruction once obstacle warning finishes
      if (options.isObstacle && interruptedInstructionRef.current && navigationStateRef.current?.isNavigating) {
        const toResume = interruptedInstructionRef.current;
        interruptedInstructionRef.current = null;
        setTimeout(() => {
          if (navigationStateRef.current?.isNavigating && !isSpeakingRef.current) {
            speakText(toResume, selectedLanguageRef.current, { isInstruction: true });
          }
        }, 1200);
      }
    };

    // Check if browser has a genuine voice for this language
    const voices = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
    const matchedVoice = voices.find(
      (v) =>
        v.lang.toLowerCase() === lang.toLowerCase() ||
        v.lang.toLowerCase().replace("_", "-").startsWith(langPrefix)
    );

    // Prefer server-side Neural TTS (Edge TTS) for Kannada and Malayalam, or if browser lacks a native voice
    const requiresServerTTS = langPrefix === "kn" || langPrefix === "ml" || !matchedVoice;

    if (requiresServerTTS) {
      const abortController = new AbortController();
      currentTtsAbortControllerRef.current = abortController;
      isSpeakingRef.current = true;

      fetch("/tts/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, lang }),
        signal: abortController.signal
      })
        .then((res) => {
          if (!res.ok) throw new Error(`Server TTS HTTP ${res.status}`);
          return res.json();
        })
        .then((data) => {
          if (abortController.signal.aborted) return;
          if (data.status === "success" && data.audioUrl) {
            const audio = new Audio(data.audioUrl);
            currentAudioRef.current = audio;

            audio.onplay = () => {
              isSpeakingRef.current = true;
            };
            audio.onended = cleanupSpeaking;
            audio.onerror = (e) => {
              console.warn("Audio playback error:", e);
              cleanupSpeaking();
            };

            const maxDurationMs = Math.max(3000, Math.ceil(text.length * 120));
            ttsSafetyTimeoutRef.current = setTimeout(cleanupSpeaking, maxDurationMs);

            audio.play().catch((err) => {
              console.warn("Audio play() was interrupted or blocked:", err);
              cleanupSpeaking();
            });
          } else {
            throw new Error(data.message || "TTS generation failed");
          }
        })
        .catch((err) => {
          if (err.name === "AbortError") return;
          console.warn("Server-side neural TTS failed:", err.message);

          // Fallback: ONLY use browser speech synthesis if a genuine voice exists for this language!
          // NEVER speak Kannada or Malayalam text using an English default voice!
          if (matchedVoice && window.speechSynthesis) {
            const speech = new SpeechSynthesisUtterance(text);
            activeUtteranceRef.current = speech;
            speech.lang = lang;
            speech.voice = matchedVoice;
            speech.onstart = () => {
              isSpeakingRef.current = true;
            };
            speech.onend = cleanupSpeaking;
            speech.onerror = cleanupSpeaking;
            const maxDurationMs = Math.max(2500, Math.ceil(text.length * 85));
            ttsSafetyTimeoutRef.current = setTimeout(cleanupSpeaking, maxDurationMs);
            window.speechSynthesis.speak(speech);
          } else {
            console.error(`No genuine voice available for language: ${lang}. Aborting speech synthesis.`);
            cleanupSpeaking();
          }
        });
      return;
    }

    // Standard browser speechSynthesis path for languages with genuine browser voice (e.g. English)
    if (window.speechSynthesis) {
      const speech = new SpeechSynthesisUtterance(text);
      activeUtteranceRef.current = speech;
      speech.lang = lang;
      if (matchedVoice) {
        speech.voice = matchedVoice;
      }
      speech.onstart = () => {
        isSpeakingRef.current = true;
      };
      speech.onend = cleanupSpeaking;
      speech.onerror = cleanupSpeaking;

      const maxDurationMs = Math.max(2500, Math.ceil(text.length * 85));
      ttsSafetyTimeoutRef.current = setTimeout(cleanupSpeaking, maxDurationMs);
      window.speechSynthesis.speak(speech);
    }
  };
  speakTextRef.current = speakText;

  // ---------------- Voice Commands Handler ----------------
  const handleVoiceCommand = (command, rawTranscript = "") => {
    console.log("Processing Voice Command:", command);
    setLastExecutedCommand(command.type + (command.destination ? `: ${command.destination}` : ""));

    switch (command.type) {
      case "CHANGE_LANGUAGE":
        setLanguage(command.language);
        speakText(
          getMessage("languageChanged", command.language, { name: command.languageName }),
          command.language
        );
        break;

      case "HELP":
        speakText(t("messages.help"));
        break;

      case "REPEAT_ONBOARDING":
        speakText(t("messages.onboarding"));
        break;

      case "START_LIVE_DETECTION":
        startLiveDetection();
        speakText(t("messages.cameraStarted"));
        break;

      case "STOP_LIVE_DETECTION":
        stopLiveDetection();
        break;

      case "DESCRIBE_AROUND":
        if (!mediaStreamRef.current) {
          startLiveDetection();
          speakText(t("messages.cameraSurroundingsScanning"));
          setTimeout(() => describeSurroundings(), 1200);
        } else {
          describeSurroundings();
        }
        break;

      case "OBSTACLE_QUERY":
        if (!mediaStreamRef.current) {
          startLiveDetection();
          speakText(t("messages.cameraCheckingObstacles"));
          setTimeout(() => {
            if (latestDetectionsRef.current.length > 0) {
              const sentences = latestDetectionsRef.current.map((d) =>
                formatDetectionSentence(d, selectedLanguageRef.current)
              );
              speakText(sentences.join(". "));
            } else {
              speakText(t("messages.noObjectsInView"));
            }
          }, 1200);
        } else if (latestDetectionsRef.current.length > 0) {
          const sentences = latestDetectionsRef.current.map((d) =>
            formatDetectionSentence(d, selectedLanguageRef.current)
          );
          speakText(sentences.join(". "));
        } else {
          speakText(t("messages.noObjectsInView"));
        }
        break;

      case "READ_TEXT":
        if (!mediaStreamRef.current) {
          startLiveDetection();
          speakText(t("messages.readingText"));
          setTimeout(() => captureFrameForOCR(), 1200);
        } else {
          captureFrameForOCR();
        }
        break;

      case "READ_QR":
        setNavigationMode("indoor");
        navigationModeRef.current = "indoor";
        speakText(t("messages.qrPrompt"));
        break;

      case "OPEN_INDOOR":
      case "START_INDOOR":
        setNavigationMode("indoor");
        navigationModeRef.current = "indoor";
        speakText(t("messages.indoorPrompt"));
        break;

      case "OPEN_OUTDOOR":
        setNavigationMode("outdoor");
        navigationModeRef.current = "outdoor";
        speakText(t("messages.outdoorPrompt"));
        break;

      case "START_SLAM":
        setNavigationMode("indoor");
        navigationModeRef.current = "indoor";
        setIndoorUiSync((prev) => ({ ...(prev || {}), subTab: "slam", slamCommand: "start", ts: Date.now() }));
        if (slamControlRef.current) {
          slamControlRef.current.start();
        }
        speakText(t("messages.slamStarted"));
        break;

      case "STOP_SLAM":
        setIndoorUiSync((prev) => ({ ...(prev || {}), slamCommand: "stop", ts: Date.now() }));
        if (slamControlRef.current) {
          slamControlRef.current.stop();
        }
        speakText(t("messages.slamStopped"));
        break;

      case "PAUSE_SLAM":
        setIndoorUiSync((prev) => ({ ...(prev || {}), slamCommand: "pause", ts: Date.now() }));
        if (slamControlRef.current) {
          slamControlRef.current.pause();
        }
        speakText(t("messages.navPaused"));
        break;

      case "RESUME_SLAM":
        setIndoorUiSync((prev) => ({ ...(prev || {}), slamCommand: "resume", ts: Date.now() }));
        if (slamControlRef.current) {
          slamControlRef.current.resume();
        }
        speakText(t("messages.navResumed"));
        break;

      case "START_NAVIGATION":
        if (command.destination) {
          setManualDestination(command.destination);
          initiateNavigation(command.destination);
        } else if (navigationState.isPaused) {
          navigationManagerRef.current?.resumeNavigation();
          speakText(t("messages.navResumed"));
        } else if (indoorNavigationManagerRef.current?.isPaused) {
          indoorNavigationManagerRef.current?.resumeNavigation();
          speakText(t("messages.navResumed"));
        } else {
          setVoiceNavSessionActive(true);
          voiceNavSessionActiveRef.current = true;
          speakText(t("messages.voiceNavActivePrompt"));
        }
        break;

      case "NAVIGATE_TO":
      case "POSSIBLE_DESTINATION": {
        const target = command.destination || rawTranscript;
        if (target && target.trim()) {
          const clean = target.trim();
          setManualDestination(clean);
          if (navigationModeRef.current === "indoor") {
            voiceOrchestratorRef.current?.processTranscript(`take me to ${clean}`);
          } else {
            initiateNavigation(clean);
          }
        }
        break;
      }

      case "STOP_NAVIGATION":
      case "CANCEL":
        stopAllNavigation();
        if (slamControlRef.current?.isExploring?.()) {
          slamControlRef.current.stop();
        }
        break;

      case "PAUSE_NAVIGATION":
        if (navigationState.isNavigating) {
          navigationManagerRef.current?.pauseNavigation();
          pauseLiveDetectionRef.current?.();
          speakText(t("messages.navPaused"));
        } else if (indoorNavigationManagerRef.current?.isNavigating) {
          indoorNavigationManagerRef.current.pauseNavigation();
          speakText(t("messages.navPaused"));
        } else if (slamControlRef.current?.isExploring?.()) {
          slamControlRef.current.pause();
          speakText(t("messages.navPaused"));
        } else {
          speakText(t("messages.noActiveNavToPause"));
        }
        break;

      case "RESUME_NAVIGATION":
        if (navigationManagerRef.current?.isPaused) {
          navigationManagerRef.current.resumeNavigation();
          resumeLiveDetectionRef.current?.();
          speakText(t("messages.navResumed"));
        } else if (indoorNavigationManagerRef.current?.isPaused) {
          indoorNavigationManagerRef.current.resumeNavigation();
          speakText(t("messages.navResumed"));
        } else if (slamControlRef.current) {
          slamControlRef.current.resume();
          speakText(t("messages.navResumed"));
        } else {
          speakText(t("messages.noPausedNavToResume"));
        }
        break;

      case "REPEAT_INSTRUCTION":
        if (navigationState.isNavigating) {
          navigationManagerRef.current?.repeatInstruction();
        } else if (indoorNavigationManagerRef.current?.isNavigating) {
          indoorNavigationManagerRef.current.repeatInstruction();
        } else {
          speakText(t("messages.navNoActiveRoute"));
        }
        break;

      case "REROUTE":
        if (navigationState.isNavigating) {
          speakText(t("messages.recalculatingRoute"));
          navigationManagerRef.current?.handleOffRoute?.(selectedLanguageRef.current);
        } else {
          speakText(t("messages.navNoActiveRoute"));
        }
        break;

      case "ROUTE_PROGRESS":
        if (navigationState.isNavigating) {
          const progMsg = getMessage("routeProgress", selectedLanguageRef.current, {
            distance: navigationState.formattedDistance || formatDistance(0, selectedLanguageRef.current),
            duration: navigationState.formattedDuration || formatDuration(0, selectedLanguageRef.current)
          });
          speakText(progMsg);
        } else {
          speakText(t("messages.navNoActiveRoute"));
        }
        break;

      case "WHERE_AM_I":
        voiceOrchestratorRef.current?.processTranscript("where am i");
        break;

      default:
        break;
    }
  };
  handleVoiceCommandRef.current = handleVoiceCommand;

  // ---------------- Initialize Singletons on Mount ----------------
  useEffect(() => {
    // 1. Initialize Speech Controller
    speechControllerRef.current = new SpeechController({
      onCommand: (cmd) => handleVoiceCommandRef.current?.(cmd),
      onTranscript: (transcript) => setLiveTranscript(transcript),
      onStateChange: ({ isListening }) => setIsVoiceControlActive(isListening),
      onError: (errMsg) => {
        setSpeechError(errMsg);
        speakTextRef.current?.(errMsg);
      },
      getLanguage: () => selectedLanguageRef.current,
      isSpeakingRef: isSpeakingRef,
      getVoiceNavActive: () => voiceNavSessionActiveRef.current,
      onVoiceNavTranscript: (transcript) => {
        voiceOrchestratorRef.current?.processTranscript(transcript);
      }
    });

    // 2. Initialize Navigation Manager
    navigationManagerRef.current = new NavigationManager({
      onStateChange: (state) => {
        setNavigationState((prev) => ({
          ...prev,
          ...state,
          routeData: state.routeData || prev.routeData
        }));
        if (state.currentPosition) {
          setUserLocation(state.currentPosition);
        }
        if (state.status === "ACTIVE" && state.isNavigating) {
          resumeLiveDetectionRef.current?.();
        } else if (state.status === "PAUSED") {
          pauseLiveDetectionRef.current?.();
        } else if (state.status === "STOPPED" || state.status === "ARRIVED") {
          stopLiveDetectionRef.current?.({ silent: true });
        }
      },
      onInstruction: ({ isInitial, destinationName, distanceText, durationText, instruction, firstInstruction }) => {
        if (navigationManagerRef.current?.isPaused) return;
        const currentLang = selectedLanguageRef.current;
        if (isInitial) {
          const confirmation = getMessage("navRouteFound", currentLang, {
            destination: destinationName,
            distance: distanceText,
            duration: durationText
          });
          const translatedFirst = translateInstructionText(firstInstruction, currentLang, destinationName);
          speakTextRef.current?.(`${confirmation} ${translatedFirst || ""}`.trim(), currentLang, { isInstruction: true });
        } else if (instruction) {
          const translatedStep = translateInstructionText(instruction, currentLang, navigationStateRef.current?.destination?.name);
          speakTextRef.current?.(translatedStep, currentLang, { isInstruction: true });
        }
      },
      onArrival: () => {
        stopLiveDetectionRef.current?.({ silent: true });
        speakTextRef.current?.(getMessage("navArrived", selectedLanguageRef.current));
      },
      onOffRoute: () => {
        speakTextRef.current?.(getMessage("navOffRoute", selectedLanguageRef.current));
      },
      onError: (errType, errMsg) => {
        if (errType === "API_KEY_UNCONFIGURED") {
          speakTextRef.current?.(getMessage("navApiKeyMissing", selectedLanguageRef.current));
          setNavigationState((prev) => ({ ...prev, status: "UNCONFIGURED" }));
        } else if (errType === "LOCATION_ERROR") {
          speakTextRef.current?.(getMessage("navGeoError", selectedLanguageRef.current));
          setNavigationState((prev) => ({ ...prev, status: "ERROR", errorMessage: errMsg }));
        } else {
          speakTextRef.current?.(errMsg || "Navigation error occurred.");
          setNavigationState((prev) => ({ ...prev, status: "ERROR", errorMessage: errMsg }));
        }
      }
    });

    // 3. Initialize Indoor Navigation Manager
    indoorNavigationManagerRef.current = new IndoorNavigationManager({
      onStateChange: (patch) => {
        setIndoorUiSync((prev) => ({ ...(prev || {}), ...patch, ts: Date.now() }));
      },
      onSpeak: (text, meta = {}) => {
        if (meta.cancel && window.speechSynthesis) {
          window.speechSynthesis.cancel();
          return;
        }
        if (!text) return;
        speakTextRef.current?.(text);
      },
      onError: (_code, message) => {
        console.error("Indoor navigation error:", message);
      }
    });

    // 4. Global Keyboard Shortcuts (Phase 2): Alt+V toggles voice listening
    const handleKeyDown = (e) => {
      if (e.altKey && (e.key === "v" || e.key === "V")) {
        e.preventDefault();
        toggleVoiceControlRef.current?.();
      }
    };
    window.addEventListener("keydown", handleKeyDown);

    // Initial GPS location fetch
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setUserLocation({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: pos.coords.accuracy
          });
        },
        () => {},
        { enableHighAccuracy: true, timeout: 10000 }
      );
    }

    if (window.speechSynthesis) {
      window.speechSynthesis.onvoiceschanged = () => {
        window.speechSynthesis.getVoices();
      };
    }

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      }
      if (speechControllerRef.current) {
        speechControllerRef.current.stopListening(true);
      }
      if (navigationManagerRef.current) {
        navigationManagerRef.current.stopNavigation(true);
      }
    };
  }, []);

  // Update speech controller language whenever context language changes
  useEffect(() => {
    if (speechControllerRef.current) {
      speechControllerRef.current.setLanguage(language);
    }
  }, [language]);

  // ---------------- Language Change Handler ----------------
  const handleLanguageChange = (langCode) => {
    setLanguage(langCode);
    navigationManagerRef.current?.setLanguage(langCode);
    if (navigationStateRef.current?.isNavigating && navigationStateRef.current?.routeData) {
      const dist = formatDistance(navigationStateRef.current.distanceMeters, langCode);
      const dur = formatDuration(navigationStateRef.current.duration, langCode);
      setNavigationState((prev) => ({
        ...prev,
        formattedDistance: dist,
        formattedDuration: dur,
        currentStep: prev.currentStep ? {
          ...prev.currentStep,
          instruction: translateInstructionText(prev.currentStep.instruction, langCode, prev.destination?.name)
        } : null
      }));
    }
    const langObj = SUPPORTED_LANGUAGES.find((l) => l.code === langCode);
    speakText(getMessage("languageChanged", langCode, { name: langObj?.name || langCode }), langCode);
  };

  // ---------------- Voice Control Toggle ----------------
  const toggleVoiceControl = () => {
    if (isVoiceControlActive) {
      speechControllerRef.current?.stopListening(true);
      speakText(t("messages.voiceControlDisabled"));
    } else {
      const started = speechControllerRef.current?.startListening();
      if (started) {
        setSpeechError("");
        speakText(t("messages.voiceControlEnabled"));
      }
    }
  };
  toggleVoiceControlRef.current = toggleVoiceControl;

  // ---------------- Describe Surroundings Command ----------------
  const describeSurroundings = () => {
    const current = latestDetectionsRef.current;
    if (!current || current.length === 0) {
      speakText(t("messages.noObjectsInView"));
      return;
    }

    const sentences = current.map((d) => formatDetectionSentence(d, language));
    const summary = sentences.join(". ");
    speakText(summary);
  };

  // ---------------- Smart Live Detection Announcement ----------------
  const announceLiveDetections = (detections) => {
    if (!detections || detections.length === 0) return;
    const now = Date.now();
    const isNavigating = !!navigationStateRef.current?.isNavigating;

    if (isNavigating) {
      const GLOBAL_NAV_COOLDOWN_MS = 5000;
      const OBJECT_NAV_COOLDOWN_MS = 12000;

      if (now - lastGlobalAnnouncementRef.current < GLOBAL_NAV_COOLDOWN_MS) {
        voiceOrchestratorRef.current?.onDetectionTick?.(detections);
        return;
      }

      // Prioritize obstacles in front of user and closer distance
      const sortedDetections = [...detections].sort((a, b) => {
        const aFront = a.direction === "in front of you" ? 0 : 1;
        const bFront = b.direction === "in front of you" ? 0 : 1;
        if (aFront !== bFront) return aFront - bFront;
        return (a.distance || 99) - (b.distance || 99);
      });

      for (const obj of sortedDetections) {
        const label = obj.class_name;
        const distance = obj.distance;
        const direction = obj.direction;
        const lastObj = lastSpokenObjectsRef.current[label];

        let shouldAnnounce = false;

        if (!lastObj) {
          shouldAnnounce = true;
        } else {
          const timeSinceLast = now - lastObj.time;
          const closerDistance =
            lastObj.distance && distance && (lastObj.distance - distance) >= 0.8;
          const directionChanged = lastObj.direction !== direction;

          if (timeSinceLast >= OBJECT_NAV_COOLDOWN_MS || closerDistance || directionChanged) {
            shouldAnnounce = true;
          }
        }

        if (shouldAnnounce) {
          lastSpokenObjectsRef.current[label] = {
            time: now,
            distance: distance,
            direction: direction
          };
          lastGlobalAnnouncementRef.current = now;

          const translatedLabel = translateObjectLabel(label, selectedLanguageRef.current);
          const translatedDir = translateDirection(direction, selectedLanguageRef.current);
          const formattedDist = distance ? `${distance}` : "2";

          const warning = getMessage("obstacleWarning", selectedLanguageRef.current, {
            label: translatedLabel,
            direction: translatedDir,
            distance: formattedDist
          });

          speakText(warning, selectedLanguageRef.current, { isObstacle: true });
          break; // Announce only highest priority obstacle to prevent spam
        }
      }
    } else {
      // Standalone live detection mode
      const GLOBAL_COOLDOWN_MS = 4000;
      const OBJECT_COOLDOWN_MS = 8000;

      if (now - lastGlobalAnnouncementRef.current < GLOBAL_COOLDOWN_MS) {
        voiceOrchestratorRef.current?.onDetectionTick?.(detections);
        return;
      }

      const toAnnounce = [];

      for (const obj of detections) {
        const label = obj.class_name;
        const lastObj = lastSpokenObjectsRef.current[label];
        const distance = obj.distance;
        const direction = obj.direction;

        let shouldAnnounce = false;

        if (!lastObj) {
          shouldAnnounce = true;
        } else {
          const timeSinceLast = now - lastObj.time;
          const distanceChanged =
            lastObj.distance && distance && Math.abs(distance - lastObj.distance) > 0.6;
          const directionChanged = lastObj.direction !== direction;

          if (timeSinceLast >= OBJECT_COOLDOWN_MS || distanceChanged || directionChanged) {
            shouldAnnounce = true;
          }
        }

        if (shouldAnnounce) {
          lastSpokenObjectsRef.current[label] = {
            time: now,
            distance: distance,
            direction: direction
          };
          toAnnounce.push(obj);
          break; // Keep announcements concise and avoid spam
        }
      }

      if (toAnnounce.length > 0) {
        const announcement = toAnnounce
          .map((d) => formatDetectionSentence(d, language))
          .join(", ");
        lastGlobalAnnouncementRef.current = now;
        speakText(announcement);
      }
    }

    voiceOrchestratorRef.current?.onDetectionTick?.(detections);
  };

  // ---------------- Live Frame Capture Loop ----------------
  const captureAndSendFrame = async () => {
    if (isProcessingFrameRef.current || !videoRef.current || !canvasRef.current) return;

    const video = videoRef.current;
    if (video.readyState < 2) return;

    isProcessingFrameRef.current = true;
    setDetectionState("PROCESSING");

    try {
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      canvas.toBlob(
        async (blob) => {
          if (!blob) {
            isProcessingFrameRef.current = false;
            setDetectionState("DETECTING");
            return;
          }

          const formData = new FormData();
          formData.append("file", blob, "frame.jpg");

          try {
            const res = await fetch(`${backendURL}/live/frame/`, {
              method: "POST",
              body: formData
            });
            const data = await res.json();
            if (data.detections) {
              setLiveDetections(data.detections);
              latestDetectionsRef.current = data.detections;
              announceLiveDetections(data.detections);
            }
          } catch (err) {
            console.error("Frame detection request error:", err);
          } finally {
            isProcessingFrameRef.current = false;
            setDetectionState("DETECTING");
          }
        },
        "image/jpeg",
        0.7
      );
    } catch (err) {
      console.error("Frame capture error:", err);
      isProcessingFrameRef.current = false;
      setDetectionState("DETECTING");
    }
  };

  // ---------------- Start / Pause / Resume / Stop Live Detection ----------------
  const startLiveDetection = async (options = {}) => {
    // If stream is already active and polling is active, do nothing to avoid duplicate streams/intervals
    if (mediaStreamRef.current && pollIntervalRef.current) {
      return;
    }

    // If stream is already active but polling was paused, resume interval
    if (mediaStreamRef.current && !pollIntervalRef.current) {
      pollIntervalRef.current = setInterval(captureAndSendFrame, 2000);
      setDetectionState("DETECTING");
      return;
    }

    setCameraError("");
    setDetectionState("STARTING");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } }
      });
      mediaStreamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setDetectionState("DETECTING");
      if (!options.silent) {
        speakText(t("messages.cameraStarted"));
      }

      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = setInterval(captureAndSendFrame, 2000);
    } catch (err) {
      console.error("Camera access failed:", err);
      const errMsg = t("messages.cameraError");
      setCameraError(errMsg);
      setDetectionState("ERROR");
      if (options.silent) {
        speakText(`${errMsg}. Continuing route navigation.`);
      } else {
        speakText(errMsg);
      }
    }
  };

  const pauseLiveDetection = () => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    setDetectionState("PAUSED");
  };

  const resumeLiveDetection = () => {
    if (mediaStreamRef.current) {
      if (!pollIntervalRef.current) {
        pollIntervalRef.current = setInterval(captureAndSendFrame, 2000);
      }
      setDetectionState("DETECTING");
    } else {
      startLiveDetection({ silent: true });
    }
  };

  const stopLiveDetection = (options = {}) => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    if (window.speechSynthesis && !options.silent) {
      window.speechSynthesis.cancel();
    }
    isProcessingFrameRef.current = false;
    setDetectionState("STOPPED");
    setLiveDetections([]);
    latestDetectionsRef.current = [];
    if (!options.silent) {
      speakText(t("messages.cameraStopped"));
    }
  };

  startLiveDetectionRef.current = startLiveDetection;
  pauseLiveDetectionRef.current = pauseLiveDetection;
  resumeLiveDetectionRef.current = resumeLiveDetection;
  stopLiveDetectionRef.current = stopLiveDetection;

  // ---------------- Snapshot OCR from Live Video ("Read this") ----------------
  const captureFrameForOCR = async () => {
    if (!videoRef.current || !canvasRef.current || !mediaStreamRef.current) {
      speakText("Camera is not active. Please start live detection first or upload an image.");
      return;
    }

    const video = videoRef.current;
    if (video.readyState < 2) {
      speakText("Camera is warming up. Please try again.");
      return;
    }

    speakText(t("messages.readingText"));

    const canvas = canvasRef.current;
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    canvas.toBlob(
      async (blob) => {
        if (!blob) return;
        const formData = new FormData();
        formData.append("file", blob, "snapshot_ocr.jpg");

        try {
          const res = await fetch(`${backendURL}/ocr/`, {
            method: "POST",
            body: formData
          });
          const data = await res.json();
          if (data.text && data.text.trim()) {
            setOcrResult(data.text);
            speakText(t("messages.textExtracted") + data.text);
          } else {
            setOcrResult("");
            speakText(t("messages.noTextFound"));
          }
        } catch (err) {
          console.error(err);
          speakText("Error reading text from image.");
        }
      },
      "image/jpeg",
      0.9
    );
  };

  // ---------------- Static File OCR Handler ----------------
  const handleOCR = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch(`${backendURL}/ocr/`, {
        method: "POST",
        body: formData
      });
      const data = await res.json();
      setOcrResult(data.text);
      if (data.text) {
        speakText(t("messages.textExtracted") + data.text);
      } else {
        speakText(t("messages.noTextFound"));
      }
    } catch (err) {
      console.error(err);
      speakText("Error reading text from image.");
    }
  };

  // ---------------- Static File Object Detection ----------------
  const handleObjectDetection = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append("image", file);

    try {
      const res = await fetch(`${backendURL}/detect/`, {
        method: "POST",
        body: formData
      });
      const data = await res.json();
      setObjectResult(data.detections || []);
      if (data.detections?.length > 0) {
        const names = data.detections
          .map((d) => translateObjectLabel(d.class_name, language))
          .join(", ");
        speakText("Objects detected: " + names);
      } else {
        speakText(t("messages.noObjectsInView"));
      }
    } catch (err) {
      console.error(err);
      speakText("Error detecting objects.");
    }
  };

  // ---------------- Speech to Text Recording ----------------
  const handleStartRecording = () => {
    if (!("webkitSpeechRecognition" in window || "SpeechRecognition" in window)) {
      alert(t("messages.sttNotSupported"));
      return;
    }

    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRec();
    recognition.continuous = true;
    recognition.lang = language;

    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((result) => result[0].transcript)
        .join("");
      setSttResult(transcript);
    };

    recognition.onend = () => {
      setIsRecording(false);
    };

    recognition.start();
    setIsRecording(true);
    speakText("Recording started. Speak now.");
  };

  const handleStopRecording = () => {
    setIsRecording(false);
    speakText("Recording stopped.");
  };

  const handleTTS = () => {
    if (!ttsText.trim()) return;
    speakText(ttsText);
  };

  // ---------------- Walking Navigation Handlers ----------------
  const initiateNavigation = async (destinationQuery) => {
    if (!destinationQuery) return;
    const destName = typeof destinationQuery === "object"
      ? (destinationQuery.name || "Selected Destination")
      : destinationQuery.trim();
    if (!destName) return;

    setActiveTab("dashboard");
    setManualDestination(destName);
    setNavigationMode("outdoor");
    navigationModeRef.current = "outdoor";
    speakText(
      getMessage("navDestinationConfirmation", language, { destination: destName })
    );

    const opts = {};
    if (userLocation) {
      opts.origin = userLocation;
      opts.isDemo = !!userLocation.isDemo;
    }
    navigationManagerRef.current?.startNavigation(destinationQuery, language, opts);
    startLiveDetectionRef.current?.({ silent: true });
  };

  const stopAllNavigation = () => {
    navigationManagerRef.current?.stopNavigation(true);
    indoorNavigationManagerRef.current?.stopNavigation(true);
    voiceOrchestratorRef.current?.stopActiveNavigation?.(true);
    stopLiveDetectionRef.current?.({ silent: true });
    speakText(t("messages.navStopped"));
  };

  const stopNavigation = () => {
    stopAllNavigation();
  };

  const orchestratorDeps = {
    outdoorNav: {
      startNavigation: (dest, lang) => {
        navigationManagerRef.current?.startNavigation(dest, lang);
        startLiveDetectionRef.current?.({ silent: true });
      },
      stopNavigation: (u) => {
        navigationManagerRef.current?.stopNavigation(u);
        stopLiveDetectionRef.current?.({ silent: true });
      },
      pause: () => {
        navigationManagerRef.current?.pauseNavigation();
        pauseLiveDetectionRef.current?.();
      },
      resume: () => {
        navigationManagerRef.current?.resumeNavigation();
        resumeLiveDetectionRef.current?.();
      },
      repeatInstruction: () => navigationManagerRef.current?.repeatInstruction(),
      getCurrentLocation: () => navigationManagerRef.current?.getCurrentLocation(),
      recalculateRoute: () => navigationManagerRef.current?.handleOffRoute?.(selectedLanguageRef.current),
      getProgress: () => ({
        distanceText: navigationState.formattedDistance || "calculating",
        durationText: navigationState.formattedDuration || "calculating"
      }),
      getNextTurnInstruction: () => {
        const nextIdx = navigationState.currentStepIndex + 1;
        if (navigationState.steps && navigationState.steps[nextIdx]) {
          const rawInst = navigationState.steps[nextIdx].instruction;
          const translated = translateInstructionText(rawInst, selectedLanguageRef.current, navigationState.destination?.name);
          return getMessage("nextTurnPrompt", selectedLanguageRef.current, {
            instruction: translated
          });
        }
        return translateInstructionText(navigationState.currentStep?.instruction, selectedLanguageRef.current, navigationState.destination?.name) || "";
      }
    },
    indoorNav: {
      stop: (c) => indoorNavigationManagerRef.current?.stopNavigation(c),
      pause: () => indoorNavigationManagerRef.current?.pauseNavigation(),
      resume: () => indoorNavigationManagerRef.current?.resumeNavigation(),
      repeatInstruction: () => indoorNavigationManagerRef.current?.repeatInstruction(),
      nextStep: () => indoorNavigationManagerRef.current?.nextStep(),
      applyRoute: (route, meta) => indoorNavigationManagerRef.current?.applyRoute(route, meta)
    },
    slamControl: slamControlRef,
    onAppCommand: (cmd, raw) => handleVoiceCommandRef.current?.(cmd, raw),
    syncIndoorUi: (patch) => setIndoorUiSync((prev) => ({ ...(prev || {}), ...patch, ts: Date.now() })),
    setNavigationMode: (mode) => setNavigationMode(mode),
    getNavigationMode: () => navigationModeRef.current,
    getLatestDetections: () => latestDetectionsRef.current,
    getLastOcrText: () => ocrResult,
    getLanguage: () => selectedLanguageRef.current,
    getHelpText: () => t("messages.help"),
    captureFrameForOCR: () => captureFrameForOCR(),
    describeSurroundings: () => describeSurroundings(),
    triggerQrScan: () => {
      setNavigationMode("indoor");
    }
  };

  // ---------------- UI Renderers ----------------
  const renderHome = () => (
    <main className="home-container" role="main">
      <div className="hero-icon" aria-hidden="true">👁️</div>
      <h1 className="hero-title">{t("hero_title")}</h1>
      <p className="hero-subtitle">{t("hero_subtitle")}</p>
      <button
        className="cta-button"
        onClick={() => {
          setActiveTab("dashboard");
          speakText(t("messages.onboarding"));
        }}
        aria-label={t("get_started")}
      >
        {t("get_started")}
      </button>
    </main>
  );

  const renderDashboard = () => (
    <div className="dashboard" role="region" aria-label={t("dashboard")}>
      <header className="dashboard-header">
        <h1 className="dashboard-title" id="voice-nav-heading">
          {t("app_name")} — {t("dashboard")}
        </h1>
      </header>

      {/* Accessible Top Bar: Language & Master Voice Control */}
      <div className="controls-topbar" role="toolbar" aria-label={t("toolbar_label")}>
        <div className="lang-selector-group">
          <label htmlFor="language-select" className="lang-label">
            🌐 {t("language")}:
          </label>
          <select
            id="language-select"
            className="lang-select"
            value={language}
            onChange={(e) => handleLanguageChange(e.target.value)}
            aria-label={t("select_language")}
          >
            {SUPPORTED_LANGUAGES.map((lang) => (
              <option key={lang.code} value={lang.code}>
                {lang.flag} {lang.name} ({lang.nativeName})
              </option>
            ))}
          </select>
        </div>

        <div>
          <button
            onClick={toggleVoiceControl}
            className={`primary-btn ${isVoiceControlActive ? "danger-btn" : "success-btn"}`}
            aria-label={isVoiceControlActive ? t("stop_voice_listening") : t("enable_voice_commands")}
          >
            <div
              className="pulse-dot"
              style={{ background: isVoiceControlActive ? "#ff4757" : "#2ed573" }}
              aria-hidden="true"
            />
            {isVoiceControlActive ? t("stop_voice_listening") : t("enable_voice_commands")}
            <span style={{ fontSize: "0.8rem", opacity: 0.8, marginLeft: "4px" }}>(Alt+V)</span>
          </button>
        </div>
      </div>

      {/* Live Voice Status Region */}
      {isVoiceControlActive && (
        <div
          className="result-box"
          style={{ borderColor: "#667eea", background: "rgba(102, 126, 234, 0.1)", marginBottom: "25px" }}
          aria-live="polite"
        >
          <div className="result-title" style={{ color: "#a5b4fc" }}>
            🎤 {t("voice_control_active")} ({SUPPORTED_LANGUAGES.find((l) => l.code === language)?.name}):
          </div>
          <div className="result-content">
            {liveTranscript ? (
              <span>
                {t("heard")}: "{liveTranscript}"
              </span>
            ) : (
              <span>{t("listening_for_commands")}</span>
            )}
          </div>
          {lastExecutedCommand && (
            <div style={{ marginTop: "6px", fontSize: "0.95rem", color: "#4facfe" }}>
              ⚡ {t("last_action")}: <strong>{lastExecutedCommand}</strong>
            </div>
          )}
        </div>
      )}

      {/* Spoken / Recognized Voice Error */}
      {speechError && (
        <div
          className="result-box"
          style={{ borderColor: "#f44336", color: "#f44336", marginBottom: "25px" }}
          aria-live="assertive"
          role="alert"
        >
          ⚠️ {speechError}
        </div>
      )}

      {/* Primary Voice-First Navigation Experience (Phase 2 Onboarding & Session) */}
      <VoiceNavigationExperience
        speakText={speakText}
        speechSupported={
          !!(typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition))
        }
        onEnableListening={() => {
          const started = speechControllerRef.current?.startListening();
          if (started) setSpeechError("");
          return started;
        }}
        onDisableListening={(userInitiated) => {
          speechControllerRef.current?.stopListening(userInitiated !== false);
          setVoiceNavSessionActive(false);
          voiceNavSessionActiveRef.current = false;
        }}
        isListening={isVoiceControlActive}
        isSpeakingRef={isSpeakingRef}
        orchestratorDeps={orchestratorDeps}
        onOrchestratorReady={(orch) => {
          voiceOrchestratorRef.current = orch;
        }}
        onSessionChange={({ sessionActive }) => {
          setVoiceNavSessionActive(!!sessionActive);
          voiceNavSessionActiveRef.current = !!sessionActive;
        }}
      />

      {/* Walking / Indoor Voice Navigation Card (Phases 4, 5, 6) */}
      <section className="feature-card" aria-label={t("nav_title")}>
        <div className="card-header">
          <div className="card-icon" aria-hidden="true">🚶</div>
          <div>
            <h2 className="card-title">{t("nav_title")}</h2>
            <p style={{ color: "rgba(255, 255, 255, 0.6)", fontSize: "0.95rem", marginTop: "4px" }}>
              {t("nav_subtitle")}
            </p>
          </div>
        </div>

        <div className="nav-mode-toggle" role="tablist" aria-label="Navigation mode">
          <button
            type="button"
            role="tab"
            aria-selected={navigationMode === "outdoor"}
            className={`nav-mode-btn ${navigationMode === "outdoor" ? "active" : ""}`}
            onClick={() => setNavigationMode("outdoor")}
          >
            {t("mode_outdoor")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={navigationMode === "indoor"}
            className={`nav-mode-btn ${navigationMode === "indoor" ? "active" : ""}`}
            onClick={() => setNavigationMode("indoor")}
          >
            {t("mode_indoor")}
          </button>
        </div>

        {navigationMode === "outdoor" ? (
          <>
            <p style={{ color: "rgba(255, 255, 255, 0.6)", fontSize: "0.95rem", marginTop: "8px" }}>
              {t("outdoor_prompt")}
            </p>
            <div className="nav-input-row">
              <input
                type="text"
                className="nav-input"
                placeholder={t("destination_input_placeholder")}
                value={manualDestination}
                onChange={(e) => setManualDestination(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && initiateNavigation(manualDestination)}
                aria-label={t("destination_input_aria")}
              />
              <button
                onClick={() => initiateNavigation(manualDestination)}
                className="primary-btn"
                disabled={!manualDestination.trim()}
                aria-label={t("btn_navigate")}
              >
                {t("btn_navigate")}
              </button>
              {navigationState.isNavigating && (
                <button
                  onClick={stopNavigation}
                  className="primary-btn danger-btn"
                  aria-label={t("btn_stop_nav")}
                >
                  {t("btn_stop_nav")}
                </button>
              )}
            </div>

            {/* Real Outdoor Map Component (Phase 4) */}
            <OutdoorMap
              userLocation={userLocation}
              destinationLocation={navigationState.destination?.location}
              destinationName={navigationState.destination?.name}
              destinationAddress={navigationState.destination?.address}
              routeData={navigationState.routeData}
              currentStepIndex={navigationState.currentStepIndex}
              isNavigating={navigationState.isNavigating}
              status={navigationState.status}
              errorMessage={navigationState.errorMessage}
              detectionState={detectionState}
              liveDetections={liveDetections}
              onSelectCategory={(categoryQuery) => {
                setManualDestination(categoryQuery);
                initiateNavigation(categoryQuery);
              }}
              onSelectDestination={(dest) => {
                const label = dest.name || `${dest.latitude.toFixed(4)}, ${dest.longitude.toFixed(4)}`;
                setManualDestination(label);
                initiateNavigation(dest);
              }}
              onUseDemoLocation={(demoOrigin) => {
                setUserLocation(demoOrigin);
                speakText(t("messages.demoGpsSet"));
              }}
              onNextStep={() => {
                navigationManagerRef.current?.nextStep();
              }}
              onRepeatInstruction={() => {
                navigationManagerRef.current?.repeatInstruction();
              }}
            />

            {navigationState.isNavigating && (
              <div
                className="result-box"
                style={{ borderColor: "#4facfe", background: "rgba(79, 172, 254, 0.1)", marginTop: "14px" }}
                aria-live="polite"
              >
                <div className="result-title" style={{ color: "#00f2fe" }}>
                  🚶 {t("navigating_to")} {navigationState.destination?.name || t("destination")}
                </div>
                <div className="result-content">
                  {navigationState.destination?.address && (
                    <div style={{ fontSize: "0.95rem", opacity: 0.8, marginBottom: "8px" }}>
                      📍 {navigationState.destination.address}
                    </div>
                  )}
                  <div style={{ display: "flex", gap: "20px", flexWrap: "wrap", margin: "10px 0" }}>
                    <div>
                      <strong>{t("remaining_distance")}</strong>{" "}
                      {navigationState.formattedDistance || t("calculating")}
                    </div>
                    <div>
                      <strong>{t("estimated_time")}</strong>{" "}
                      {navigationState.formattedDuration || t("calculating")}
                    </div>
                  </div>

                  {navigationState.currentStep && (
                    <div
                      style={{
                        background: "rgba(255, 255, 255, 0.08)",
                        padding: "14px 18px",
                        borderRadius: "10px",
                        marginTop: "12px",
                        borderLeft: "4px solid #00f2fe"
                      }}
                    >
                      <div style={{ fontSize: "0.9rem", color: "#a5b4fc" }}>{t("current_spoken_step")}</div>
                      <div style={{ fontSize: "1.2rem", fontWeight: 600, marginTop: "4px" }}>
                        {navigationState.currentStep.instruction}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        ) : (
          <IndoorNavigationPanel
            speakText={speakText}
            onStopOutdoorSpeech={() => {
              if (window.speechSynthesis) window.speechSynthesis.cancel();
            }}
            sharedManagerRef={indoorNavigationManagerRef}
            uiSync={indoorUiSync}
            onMarkerApplied={(marker) => {
              console.log("Marker applied:", marker);
            }}
            voiceOrchestratorRef={voiceOrchestratorRef}
            slamControlRef={slamControlRef}
          />
        )}
      </section>

      {/* Accessible Voice Commands Reference Card */}
      <section className="feature-card" aria-label={t("supported_commands_title")}>
        <div className="card-header">
          <div className="card-icon" aria-hidden="true">🗣️</div>
          <div>
            <h2 className="card-title">{t("supported_commands_title")}</h2>
            <p style={{ color: "rgba(255, 255, 255, 0.6)", fontSize: "0.95rem", marginTop: "4px" }}>
              {t("supported_commands_subtitle")}
            </p>
          </div>
        </div>

        <div className="commands-grid">
          <button
            className="command-btn"
            onClick={() => handleVoiceCommand({ type: "START_LIVE_DETECTION" })}
            aria-label={t("cmd_start_detection")}
          >
            <span className="command-icon">▶️</span>
            <div>
              <strong>{t("cmd_start_detection")}</strong>
              <div style={{ fontSize: "0.85rem", opacity: 0.7 }}>{t("cmd_start_detection_desc")}</div>
            </div>
          </button>

          <button
            className="command-btn"
            onClick={() => handleVoiceCommand({ type: "STOP_LIVE_DETECTION" })}
            aria-label={t("cmd_stop_detection")}
          >
            <span className="command-icon">⏹️</span>
            <div>
              <strong>{t("cmd_stop_detection")}</strong>
              <div style={{ fontSize: "0.85rem", opacity: 0.7 }}>{t("cmd_stop_detection_desc")}</div>
            </div>
          </button>

          <button
            className="command-btn"
            onClick={() => handleVoiceCommand({ type: "DESCRIBE_AROUND" })}
            aria-label={t("cmd_what_around")}
          >
            <span className="command-icon">🧭</span>
            <div>
              <strong>{t("cmd_what_around")}</strong>
              <div style={{ fontSize: "0.85rem", opacity: 0.7 }}>{t("cmd_what_around_desc")}</div>
            </div>
          </button>

          <button
            className="command-btn"
            onClick={() => handleVoiceCommand({ type: "READ_TEXT" })}
            aria-label={t("cmd_read_text")}
          >
            <span className="command-icon">📖</span>
            <div>
              <strong>{t("cmd_read_text")}</strong>
              <div style={{ fontSize: "0.85rem", opacity: 0.7 }}>{t("cmd_read_text_desc")}</div>
            </div>
          </button>

          <button
            className="command-btn"
            onClick={() => speakText(t("messages.help"))}
            aria-label={t("cmd_help")}
          >
            <span className="command-icon">❓</span>
            <div>
              <strong>{t("cmd_help")}</strong>
              <div style={{ fontSize: "0.85rem", opacity: 0.7 }}>{t("cmd_help_desc")}</div>
            </div>
          </button>

          <button
            className="command-btn"
            onClick={() => handleVoiceCommand({ type: "STOP_NAVIGATION" })}
            aria-label={t("cmd_stop_nav")}
          >
            <span className="command-icon">🛑</span>
            <div>
              <strong>{t("cmd_stop_nav")}</strong>
              <div style={{ fontSize: "0.85rem", opacity: 0.7 }}>{t("cmd_stop_nav_desc")}</div>
            </div>
          </button>
        </div>
      </section>

      {/* Live Object Detection Card */}
      <section className="feature-card" aria-label={t("live_detection_title")}>
        <div className="card-header">
          <div className="card-icon" aria-hidden="true">📸</div>
          <h2 className="card-title">{t("live_detection_title")}</h2>
        </div>

        {/* Live Status Region */}
        <div style={{ marginBottom: "18px" }} aria-live="polite">
          <span
            className={
              detectionState === "DETECTING" || detectionState === "PROCESSING"
                ? "status-badge status-active"
                : detectionState === "STARTING"
                ? "status-badge status-processing"
                : "status-badge status-inactive"
            }
          >
            <div
              className="pulse-dot"
              style={{
                background:
                  detectionState === "DETECTING"
                    ? "#4caf50"
                    : detectionState === "PROCESSING"
                    ? "#ff9800"
                    : detectionState === "STARTING"
                    ? "#00f2fe"
                    : "#f44336"
              }}
            />
            {t("status_label")}: {detectionState}
          </span>
        </div>

        {cameraError && (
          <div
            className="result-box"
            style={{ borderColor: "#f44336", color: "#f44336", marginBottom: "15px" }}
            aria-live="assertive"
            role="alert"
          >
            ⚠️ {cameraError}
          </div>
        )}

        <div
          style={{
            margin: "15px 0",
            display:
              detectionState === "DETECTING" ||
              detectionState === "PROCESSING" ||
              detectionState === "STARTING" ||
              detectionState === "PAUSED"
                ? "block"
                : "none"
          }}
        >
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            style={{ width: "100%", maxHeight: "400px", borderRadius: "12px", background: "#000" }}
            aria-label="Camera feed for obstacle detection"
          />
          <canvas ref={canvasRef} style={{ display: "none" }} />
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", margin: "10px 0" }}>
          {detectionState !== "DETECTING" &&
          detectionState !== "PROCESSING" &&
          detectionState !== "STARTING" ? (
            <button
              onClick={startLiveDetection}
              className="primary-btn success-btn"
              aria-label={t("btn_start_live")}
            >
              {t("btn_start_live")}
            </button>
          ) : (
            <>
              <button
                onClick={stopLiveDetection}
                className="primary-btn danger-btn"
                aria-label={t("btn_stop_live")}
              >
                {t("btn_stop_live")}
              </button>
              <button
                onClick={captureFrameForOCR}
                className="primary-btn accent-btn"
                aria-label={t("btn_read_signboard")}
              >
                {t("btn_read_signboard")}
              </button>
              <button
                onClick={describeSurroundings}
                className="primary-btn"
                aria-label={t("btn_what_front")}
              >
                {t("btn_what_front")}
              </button>
            </>
          )}
        </div>

        {liveDetections.length > 0 && (
          <div className="result-box" aria-live="polite">
            <div className="result-title">{t("current_detections_title")}</div>
            <ul className="detection-list">
              {liveDetections.map((obj, i) => (
                <li key={i} className="detection-item">
                  <strong>{translateObjectLabel(obj.class_name, language)}</strong>
                  {obj.distance && ` - ${obj.distance}${t("meters_away")}`}
                  {obj.direction && ` - ${translateDirection(obj.direction, language)}`}
                  {obj.confidence && ` (${(obj.confidence * 100).toFixed(1)}%)`}
                </li>
              ))}
            </ul>
          </div>
        )}

        {(detectionState === "DETECTING" || detectionState === "PROCESSING") &&
          liveDetections.length === 0 && (
            <div className="result-box" aria-live="polite">
              <div
                className="result-content"
                style={{ textAlign: "center", color: "rgba(255, 255, 255, 0.6)" }}
              >
                {t("monitoring_no_obstacles")}
              </div>
            </div>
          )}
      </section>

      {/* OCR Card (Single Image / Upload) */}
      <section className="feature-card" aria-label={t("ocr_title")}>
        <div className="card-header">
          <div className="card-icon" aria-hidden="true">📖</div>
          <h2 className="card-title">{t("ocr_title")}</h2>
        </div>

        <div className="file-input-wrapper">
          <input
            type="file"
            accept="image/*"
            onChange={handleOCR}
            id="ocr-input"
            aria-label={t("ocr_upload_label")}
          />
          <label htmlFor="ocr-input" className="file-input-label">
            {t("ocr_upload_label")}
          </label>
        </div>

        {ocrResult && (
          <div className="result-box" aria-live="polite">
            <div className="result-title">{t("extracted_text_title")}</div>
            <div className="result-content">{ocrResult}</div>
          </div>
        )}
      </section>

      {/* Object Detection Card (Static Image Upload) */}
      <section className="feature-card" aria-label={t("static_detect_title")}>
        <div className="card-header">
          <div className="card-icon" aria-hidden="true">👁️</div>
          <h2 className="card-title">{t("static_detect_title")}</h2>
        </div>

        <div className="file-input-wrapper">
          <input
            type="file"
            accept="image/*"
            onChange={handleObjectDetection}
            id="object-input"
            aria-label={t("static_upload_label")}
          />
          <label htmlFor="object-input" className="file-input-label">
            {t("static_upload_label")}
          </label>
        </div>

        {objectResult.length > 0 && (
          <div className="result-box" aria-live="polite">
            <div className="result-title">{t("detected_objects_title")}</div>
            <ul className="detection-list">
              {objectResult.map((obj, i) => (
                <li key={i} className="detection-item">
                  <strong>{translateObjectLabel(obj.class_name, language)}</strong> -{" "}
                  {(obj.confidence * 100).toFixed(1)}% {t("confidence_label")}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* Speech to Text Card */}
      <section className="feature-card" aria-label={t("stt_title")}>
        <div className="card-header">
          <div className="card-icon" aria-hidden="true">🎤</div>
          <h2 className="card-title">{t("stt_title")}</h2>
        </div>

        {isRecording && (
          <div className="result-box" style={{ borderColor: "#f44336", margin: "10px 0" }} aria-live="polite">
            <div className="pulse-dot" style={{ background: "#f44336", display: "inline-block", marginRight: "8px" }} />
            {t("recording_in_progress")}
          </div>
        )}

        {!isRecording ? (
          <button
            onClick={handleStartRecording}
            className="primary-btn"
            aria-label={t("btn_start_recording")}
          >
            {t("btn_start_recording")}
          </button>
        ) : (
          <button
            onClick={handleStopRecording}
            className="primary-btn danger-btn"
            aria-label={t("btn_stop_recording")}
          >
            {t("btn_stop_recording")}
          </button>
        )}

        {sttResult && (
          <div className="result-box" aria-live="polite">
            <div className="result-title">{t("transcribed_text_title")}</div>
            <div className="result-content">{sttResult}</div>
          </div>
        )}
      </section>

      {/* Text to Speech Card */}
      <section className="feature-card" aria-label={t("tts_title")}>
        <div className="card-header">
          <div className="card-icon" aria-hidden="true">🔊</div>
          <h2 className="card-title">{t("tts_title")}</h2>
        </div>

        <textarea
          className="textarea-custom"
          placeholder={t("tts_placeholder")}
          value={ttsText}
          onChange={(e) => setTtsText(e.target.value)}
          aria-label={t("tts_placeholder")}
        />

        <button
          onClick={handleTTS}
          className="primary-btn"
          style={{ marginTop: "12px" }}
          aria-label={t("btn_speak_text")}
        >
          {t("btn_speak_text")}
        </button>
      </section>
    </div>
  );

  return (
    <>
      <style>{`
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Nirmala UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
          background: #0f0f1e;
          color: white;
          overflow-x: hidden;
        }
        :focus-visible {
          outline: 3px solid #60a5fa !important;
          outline-offset: 3px !important;
        }
        .skip-link {
          position: absolute;
          top: -60px;
          left: 10px;
          background: #2563eb;
          color: #ffffff;
          padding: 12px 20px;
          border-radius: 8px;
          font-weight: 700;
          z-index: 9999;
          text-decoration: none;
          transition: top 0.2s ease;
        }
        .skip-link:focus {
          top: 10px;
        }
        .app-container {
          min-height: 100vh;
          background: linear-gradient(135deg, #0f0f1e 0%, #1a1a2e 50%, #16213e 100%);
          padding: 20px;
          position: relative;
        }
        .app-container::before {
          content: '';
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: 
            radial-gradient(circle at 20% 50%, rgba(102, 126, 234, 0.1) 0%, transparent 50%),
            radial-gradient(circle at 80% 80%, rgba(118, 75, 162, 0.1) 0%, transparent 50%);
          pointer-events: none;
          z-index: 0;
        }
        .app-content {
          position: relative;
          z-index: 1;
        }
        .nav-bar {
          display: flex;
          justify-content: center;
          gap: 15px;
          margin-bottom: 40px;
          animation: fadeInUp 0.6s ease-out;
        }
        .nav-btn {
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.1);
          padding: 12px 30px;
          border-radius: 50px;
          color: white;
          font-size: 1.05rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.3s ease;
          display: inline-flex;
          align-items: center;
          gap: 10px;
        }
        .nav-btn:hover {
          background: rgba(255, 255, 255, 0.1);
          transform: translateY(-2px);
        }
        .nav-btn.active {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          border-color: transparent;
          box-shadow: 0 10px 25px rgba(102, 126, 234, 0.3);
        }
        .home-container {
          text-align: center;
          padding: 80px 20px;
          animation: fadeInUp 0.8s ease-out;
        }
        .hero-icon {
          font-size: 120px;
          display: inline-block;
          margin-bottom: 30px;
        }
        .hero-title {
          font-size: 4rem;
          font-weight: 700;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          margin-bottom: 20px;
        }
        .hero-subtitle {
          font-size: 1.3rem;
          color: rgba(255, 255, 255, 0.8);
          max-width: 700px;
          margin: 0 auto 50px;
          line-height: 1.8;
        }
        .cta-button {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          padding: 18px 45px;
          border-radius: 50px;
          color: white;
          border: none;
          font-size: 1.3rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.3s ease;
          box-shadow: 0 10px 30px rgba(102, 126, 234, 0.4);
        }
        .cta-button:hover {
          transform: translateY(-3px);
          box-shadow: 0 15px 40px rgba(102, 126, 234, 0.6);
        }
        .dashboard {
          animation: fadeInUp 0.6s ease-out;
          max-width: 1200px;
          margin: 0 auto;
        }
        .dashboard-header {
          text-align: center;
          margin-bottom: 30px;
        }
        .dashboard-title {
          font-size: 2.8rem;
          font-weight: 700;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          margin-bottom: 15px;
        }
        .controls-topbar {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          justify-content: space-between;
          background: rgba(255, 255, 255, 0.05);
          backdrop-filter: blur(10px);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 16px;
          padding: 18px 24px;
          margin-bottom: 25px;
          gap: 15px;
        }
        .lang-selector-group {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
        }
        .lang-label {
          font-size: 1.1rem;
          font-weight: 600;
          color: rgba(255, 255, 255, 0.9);
        }
        .lang-select {
          background: #1a1a2e;
          color: #fff;
          border: 1px solid rgba(102, 126, 234, 0.5);
          padding: 10px 16px;
          border-radius: 10px;
          font-size: 1.05rem;
          font-weight: 600;
          cursor: pointer;
          outline: none;
        }
        .lang-select:focus {
          border-color: #667eea;
          box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.3);
        }
        .feature-card {
          background: rgba(255, 255, 255, 0.05);
          backdrop-filter: blur(10px);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 20px;
          padding: 26px;
          margin-bottom: 25px;
          transition: all 0.3s ease;
        }
        .feature-card:hover {
          box-shadow: 0 15px 35px rgba(0, 0, 0, 0.3);
          border-color: rgba(255, 255, 255, 0.2);
        }
        .card-header {
          display: flex;
          align-items: center;
          gap: 15px;
          margin-bottom: 18px;
        }
        .card-icon {
          width: 50px;
          height: 50px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 12px;
          background: linear-gradient(135deg, rgba(102, 126, 234, 0.2), rgba(118, 75, 162, 0.2));
          font-size: 28px;
        }
        .card-title {
          font-size: 1.4rem;
          font-weight: 600;
          margin: 0;
        }
        .primary-btn {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          border: none;
          padding: 14px 26px;
          border-radius: 12px;
          font-size: 1.05rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.3s ease;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          margin: 6px;
        }
        .primary-btn:hover {
          transform: translateY(-2px);
          box-shadow: 0 10px 25px rgba(102, 126, 234, 0.4);
        }
        .danger-btn {
          background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
        }
        .success-btn {
          background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%);
        }
        .accent-btn {
          background: linear-gradient(135deg, #fa709a 0%, #fee140 100%);
          color: #111;
        }
        .file-input-wrapper {
          position: relative;
          display: inline-block;
          margin: 10px 0;
        }
        .file-input-wrapper input[type="file"] {
          position: absolute;
          opacity: 0;
          width: 100%;
          height: 100%;
          cursor: pointer;
        }
        .file-input-label {
          background: rgba(255, 255, 255, 0.1);
          border: 2px dashed rgba(255, 255, 255, 0.3);
          padding: 18px 28px;
          border-radius: 12px;
          display: inline-flex;
          align-items: center;
          gap: 10px;
          cursor: pointer;
          font-size: 1rem;
          transition: all 0.3s ease;
        }
        .result-box {
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.1);
          padding: 18px;
          border-radius: 12px;
          margin-top: 18px;
        }
        .result-title {
          font-weight: 600;
          color: rgba(255, 255, 255, 0.9);
          margin-bottom: 10px;
          font-size: 1.1rem;
        }
        .result-content {
          color: rgba(255, 255, 255, 0.85);
          line-height: 1.6;
          font-size: 1.05rem;
        }
        .detection-list {
          list-style: none;
          padding: 0;
        }
        .detection-item {
          background: rgba(255, 255, 255, 0.05);
          padding: 12px 16px;
          border-radius: 8px;
          margin-bottom: 8px;
          border-left: 3px solid #667eea;
          font-size: 1.05rem;
        }
        .status-badge {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 8px 16px;
          border-radius: 20px;
          font-weight: 600;
          font-size: 0.95rem;
        }
        .status-active {
          background: rgba(76, 175, 80, 0.2);
          color: #4caf50;
        }
        .status-inactive {
          background: rgba(244, 67, 54, 0.2);
          color: #f44336;
        }
        .status-processing {
          background: rgba(255, 152, 0, 0.2);
          color: #ff9800;
        }
        .pulse-dot {
          width: 10px;
          height: 10px;
          border-radius: 50%;
        }
        .textarea-custom {
          width: 100%;
          min-height: 100px;
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 12px;
          padding: 15px;
          color: white;
          font-size: 1.05rem;
          font-family: inherit;
          resize: vertical;
        }
        .commands-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
          gap: 12px;
          margin-top: 15px;
        }
        .command-btn {
          background: rgba(255, 255, 255, 0.06);
          border: 1px solid rgba(255, 255, 255, 0.15);
          color: white;
          padding: 14px 18px;
          border-radius: 12px;
          text-align: left;
          cursor: pointer;
          font-size: 1rem;
          transition: all 0.2s ease;
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .command-btn:hover {
          background: rgba(102, 126, 234, 0.2);
          border-color: #667eea;
          transform: translateY(-2px);
        }
        .command-icon {
          font-size: 1.4rem;
        }
        .nav-input-row {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
          margin-top: 10px;
        }
        .nav-input {
          flex: 1;
          min-width: 250px;
          background: rgba(255, 255, 255, 0.08);
          border: 1px solid rgba(255, 255, 255, 0.2);
          border-radius: 12px;
          padding: 12px 18px;
          color: white;
          font-size: 1.05rem;
        }
        .nav-mode-toggle {
          display: inline-flex;
          flex-wrap: wrap;
          gap: 8px;
          margin: 12px 0 4px;
          padding: 6px;
          border-radius: 14px;
          background: rgba(255, 255, 255, 0.06);
          border: 1px solid rgba(255, 255, 255, 0.12);
        }
        .nav-mode-btn {
          border: 1px solid transparent;
          background: transparent;
          color: rgba(255, 255, 255, 0.85);
          padding: 10px 18px;
          border-radius: 10px;
          font-weight: 600;
          cursor: pointer;
        }
        .nav-mode-btn.active {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
        }
      `}</style>

      {/* Skip to Content for Screen Readers & Keyboard navigation */}
      <a href="#voice-nav-heading" className="skip-link">
        {t("skip_to_content")}
      </a>

      <div className="app-container">
        <div className="app-content">
          <nav className="nav-bar" role="navigation" aria-label="Main Navigation">
            <button
              className={`nav-btn ${activeTab === "home" ? "active" : ""}`}
              onClick={() => setActiveTab("home")}
              aria-label={t("home")}
            >
              {t("home")}
            </button>
            <button
              className={`nav-btn ${activeTab === "dashboard" ? "active" : ""}`}
              onClick={() => setActiveTab("dashboard")}
              aria-label={t("dashboard")}
            >
              {t("dashboard")}
            </button>
          </nav>

          {activeTab === "home" ? renderHome() : renderDashboard()}
        </div>
      </div>
    </>
  );
}

export function App() {
  return (
    <LanguageProvider>
      <AppContent />
    </LanguageProvider>
  );
}

export default App;