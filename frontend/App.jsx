// frontend/App.jsx
import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  IconWorld,
  IconHelp,
  IconMicrophone,
  IconPlayerStop,
  IconPlayerPlay,
  IconCompass,
  IconBook,
  IconRotateClockwise,
  IconVolume,
  IconSquareX,
  IconWalk,
  IconSatellite,
  IconBuilding,
  IconRefresh,
  IconPlayerTrackNext,
  IconCamera,
  IconInfoCircle,
  IconTools,
  IconChevronDown,
  IconEye,
  IconCrosshair,
  IconX,
  IconBolt,
  IconMapPin
} from "@tabler/icons-react";
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
import { OutdoorMap } from "./components/OutdoorMap.jsx";
import { IndoorNavigationManager } from "./utils/indoor/indoorNavigationManager.js";
import { VoiceNavigationOrchestrator } from "./utils/voiceNavigation/VoiceNavigationOrchestrator.js";

const backendURL = "";

// Demo coordinates for offline testing under Advanced Tools only
const DEMO_TEST_ORIGIN = {
  latitude: 12.3086,
  longitude: 76.6531,
  accuracy: 5,
  isDemo: true,
  label: "Demo Origin (Sayyaji Rao Road, Mysuru)"
};

function AppContent() {
  const { t, language, setLanguage } = useLanguage();

  // ---------------- Core Feature States ----------------
  const [ocrResult, setOcrResult] = useState("");
  const [objectResult, setObjectResult] = useState([]);
  const [sttResult, setSttResult] = useState("");
  const [ttsText, setTtsText] = useState("");
  const [isRecording, setIsRecording] = useState(false);

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
  const [locationStatus, setLocationStatus] = useState("IDLE"); // IDLE | LOCATING | ACTIVE | DENIED | UNAVAILABLE | TIMEOUT
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [isAdvancedToolsOpen, setIsAdvancedToolsOpen] = useState(false);

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

      case "STOP_SPEAKING":
        if (typeof window !== "undefined" && window.speechSynthesis) {
          window.speechSynthesis.cancel();
        }
        if (currentAudioRef.current) {
          currentAudioRef.current.pause();
          currentAudioRef.current = null;
        }
        isSpeakingRef.current = false;
        break;

      case "RESET_SLAM":
        setIndoorUiSync((prev) => ({ ...(prev || {}), slamCommand: "reset", ts: Date.now() }));
        if (slamControlRef.current?.reset) {
          slamControlRef.current.reset();
        } else {
          indoorNavigationManagerRef.current?.resetNavigationState?.();
        }
        speakText(t("messages.slamReset") || "Indoor scan and map reset to origin.");
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
        if (navigationModeRef.current === "indoor") {
          const perception = slamControlRef.current?.getLatestPerception?.();
          const objects = perception?.objects || [];
          if (objects.length > 0) {
            const names = objects.map((o) => `${o.class_name}${o.is_moving ? " (moving)" : ""}`);
            speakText(`Ahead indoors: ${names.join(", ")}.`);
          } else {
            speakText("No immediate indoor obstacles detected ahead in view.");
          }
          break;
        }
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
            if (indoorNavigationManagerRef.current?.navigateToDestination) {
              indoorNavigationManagerRef.current.navigateToDestination(clean);
            } else if (slamControlRef.current?.planRoute) {
              slamControlRef.current.planRoute(clean);
            } else {
              voiceOrchestratorRef.current?.processTranscript(`take me to ${clean}`);
            }
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
        } else if (navigationModeRef.current === "indoor") {
          indoorNavigationManagerRef.current?.repeatInstruction();
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
        if (navigationModeRef.current === "indoor") {
          const pose = slamControlRef.current?.getCurrentPose?.();
          const map = slamControlRef.current?.getDiscoveredMap?.();
          let msg = "";
          if (pose && (Math.abs(pose.x) > 0.1 || Math.abs(pose.y) > 0.1)) {
            msg = `You are indoors at map coordinates ${pose.x.toFixed(1)}, ${pose.y.toFixed(1)}.`;
            if (map?.landmarks?.length > 0) {
              const nearest = map.landmarks[map.landmarks.length - 1];
              msg += ` Near ${nearest.name || nearest.type}.`;
            }
          } else {
            msg = "You are at the indoor scan starting origin.";
            if (map?.landmarks?.length > 0) {
              msg += ` Discovered landmarks: ${map.landmarks.map((l) => l.name || l.type).join(", ")}.`;
            }
          }
          speakText(msg);
        } else {
          voiceOrchestratorRef.current?.processTranscript("where am i");
        }
        break;

      default:
        break;
    }
  };
  handleVoiceCommandRef.current = handleVoiceCommand;

  // ---------------- Real Geolocation Acquisition ----------------
  const requestDeviceLocation = useCallback((silent = false) => {
    if (!("geolocation" in navigator)) {
      setLocationStatus("UNAVAILABLE");
      if (!silent) speakTextRef.current?.(t("gps_unavailable"));
      return;
    }

    setLocationStatus("LOCATING");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords = {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          isDemo: false
        };
        setUserLocation(coords);
        setLocationStatus("ACTIVE");
        if (navigationManagerRef.current) {
          navigationManagerRef.current.currentPosition = coords;
          navigationManagerRef.current.isDemoLocation = false;
        }
        if (!silent) {
          speakTextRef.current?.(t("gps_available"));
        }
      },
      (err) => {
        let status = "UNAVAILABLE";
        let spokenMsg = t("gps_unavailable");
        if (err.code === 1) { // PERMISSION_DENIED
          status = "DENIED";
          spokenMsg = t("gps_permission_required");
        } else if (err.code === 2) { // POSITION_UNAVAILABLE
          status = "UNAVAILABLE";
          spokenMsg = t("gps_unavailable");
        } else if (err.code === 3) { // TIMEOUT
          status = "TIMEOUT";
          spokenMsg = t("gps_timeout");
        }
        setLocationStatus(status);
        console.warn("Geolocation acquisition error:", err.message);
        if (!silent) {
          speakTextRef.current?.(spokenMsg);
        }
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 10000 }
    );
  }, [t]);

  // ---------------- Initialize Singletons on Mount ----------------
  useEffect(() => {
    // 1. Initialize Speech Controller
    speechControllerRef.current = new SpeechController({
      onCommand: (cmd, raw) => handleVoiceCommandRef.current?.(cmd, raw),
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
          if (!state.currentPosition.isDemo) {
            setLocationStatus("ACTIVE");
          }
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
        } else if (errType === "LOCATION_ERROR" || (errType && errType.startsWith("LOCATION_"))) {
          setLocationStatus("UNAVAILABLE");
          speakTextRef.current?.(errMsg || getMessage("navGeoError", selectedLanguageRef.current));
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

    // Initial real GPS location fetch
    requestDeviceLocation(true);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      navigateToDestination: (dest) => indoorNavigationManagerRef.current?.navigateToDestination(dest),
      reset: () => {
        slamControlRef.current?.reset?.();
        indoorNavigationManagerRef.current?.resetNavigationState?.();
      },
      stop: (c) => indoorNavigationManagerRef.current?.stopNavigation(c),
      pause: () => indoorNavigationManagerRef.current?.pauseNavigation(),
      resume: () => indoorNavigationManagerRef.current?.resumeNavigation(),
      repeatInstruction: () => indoorNavigationManagerRef.current?.repeatInstruction(),
      nextStep: () => indoorNavigationManagerRef.current?.nextStep(),
      applyRoute: (route, meta) => indoorNavigationManagerRef.current?.applyRoute(route, meta)
    },
    cancelSpeech: () => {
      if (typeof window !== "undefined" && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
      if (currentAudioRef.current) {
        currentAudioRef.current.pause();
        currentAudioRef.current = null;
      }
      isSpeakingRef.current = false;
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

  // ---------------- Voice Orchestrator Lifecycle ----------------
  useEffect(() => {
    voiceOrchestratorRef.current = new VoiceNavigationOrchestrator({
      ...orchestratorDeps,
      setLanguage: (code) => setLanguage(code),
      speak: (text, meta) => speakText(text, meta?.customLang),
      isSpeaking: () => isSpeakingRef?.current,
      onStateChange: ({ sessionActive: active, error }) => {
        setVoiceNavSessionActive(!!active);
        voiceNavSessionActiveRef.current = !!active;
        if (error) setSpeechError(error);
      },
      startListening: () => {
        const started = speechControllerRef.current?.startListening();
        if (started) setSpeechError("");
        return started;
      },
      stopListening: (user) => {
        speechControllerRef.current?.stopListening(user !== false);
        setVoiceNavSessionActive(false);
        voiceNavSessionActiveRef.current = false;
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Master Voice Toggle: synchronizes speech controller & orchestrator session
  const toggleVoiceSession = async () => {
    setSpeechError("");
    if (isVoiceControlActive || voiceNavSessionActive) {
      speechControllerRef.current?.stopListening(true);
      voiceOrchestratorRef.current?.disableSession();
      setIsVoiceControlActive(false);
      setVoiceNavSessionActive(false);
      voiceNavSessionActiveRef.current = false;
      speakText(t("messages.voiceControlDisabled"));
    } else {
      setVoiceNavSessionActive(true);
      voiceNavSessionActiveRef.current = true;
      voiceOrchestratorRef.current?.enableSession();
      const started = speechControllerRef.current?.startListening();
      if (started) {
        setSpeechError("");
        speakText(t("messages.voiceControlEnabled"));
      } else {
        setVoiceNavSessionActive(false);
        voiceNavSessionActiveRef.current = false;
      }
    }
  };

  const handleFallbackSubmit = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    const query = manualDestination.trim();
    if (!query) return;

    if (voiceOrchestratorRef.current) {
      if (!voiceNavSessionActive) {
        await voiceOrchestratorRef.current.enableSession();
      }
      await voiceOrchestratorRef.current.processTranscript(query);
    } else {
      initiateNavigation(query);
    }
  };

  // Esc key listener for Help modal
  useEffect(() => {
    const handleModalEsc = (e) => {
      if (e.key === "Escape" && isHelpOpen) {
        setIsHelpOpen(false);
      }
    };
    window.addEventListener("keydown", handleModalEsc);
    return () => window.removeEventListener("keydown", handleModalEsc);
  }, [isHelpOpen]);

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
          background: #080a14;
          color: #f1f5f9;
          overflow-x: hidden;
          line-height: 1.5;
        }
        :focus-visible {
          outline: 3px solid #38bdf8 !important;
          outline-offset: 3px !important;
        }
        .skip-link {
          position: absolute;
          top: -80px;
          left: 14px;
          background: #4f46e5;
          color: #ffffff;
          padding: 12px 22px;
          border-radius: 10px;
          font-weight: 700;
          z-index: 9999;
          text-decoration: none;
          transition: top 0.2s ease;
          box-shadow: 0 4px 14px rgba(0,0,0,0.4);
        }
        .skip-link:focus {
          top: 14px;
        }

        /* Ambient app wrapper */
        .app-container {
          min-height: 100vh;
          background: radial-gradient(circle at 15% 15%, rgba(99, 102, 241, 0.12) 0%, transparent 40%),
                      radial-gradient(circle at 85% 65%, rgba(14, 165, 233, 0.08) 0%, transparent 45%),
                      #080a14;
          position: relative;
        }
        .app-shell {
          max-width: 1200px;
          margin: 0 auto;
          padding: 0 16px 60px;
        }

        /* 1. Compact Accessible Header */
        .app-header {
          position: sticky;
          top: 0;
          z-index: 1000;
          background: rgba(8, 10, 20, 0.85);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
          padding: 12px 18px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          flex-wrap: wrap;
          gap: 12px;
          margin-bottom: 24px;
        }
        .brand-cluster {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .brand-icon {
          width: 38px;
          height: 38px;
          border-radius: 10px;
          background: linear-gradient(135deg, #6366f1, #38bdf8);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 20px;
          box-shadow: 0 4px 12px rgba(99, 102, 241, 0.35);
        }
        .brand-text h1 {
          font-size: 1.35rem;
          font-weight: 700;
          letter-spacing: -0.02em;
          background: linear-gradient(135deg, #ffffff 40%, #a5b4fc 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          line-height: 1.1;
        }
        .brand-tagline {
          font-size: 0.8rem;
          color: #94a3b8;
          font-weight: 500;
        }
        .header-actions {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
        }
        .lang-select-wrap {
          display: flex;
          align-items: center;
          gap: 6px;
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.12);
          border-radius: 10px;
          padding: 6px 10px;
        }
        .header-lang-select {
          background: transparent;
          border: none;
          color: #f1f5f9;
          font-size: 0.92rem;
          font-weight: 600;
          cursor: pointer;
          outline: none;
        }
        .header-lang-select option {
          background: #111428;
          color: #fff;
        }
        .icon-btn {
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.12);
          color: #f1f5f9;
          border-radius: 10px;
          padding: 8px 14px;
          font-size: 0.92rem;
          font-weight: 600;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          transition: all 0.2s ease;
        }
        .icon-btn:hover {
          background: rgba(255, 255, 255, 0.1);
          border-color: rgba(99, 102, 241, 0.5);
        }

        /* 2. Voice-First Hero Section */
        .voice-hero-card {
          background: linear-gradient(180deg, rgba(20, 24, 52, 0.8) 0%, rgba(13, 16, 36, 0.7) 100%);
          border: 1px solid rgba(99, 102, 241, 0.25);
          border-radius: 20px;
          padding: 36px 24px;
          text-align: center;
          box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
          margin-bottom: 28px;
          position: relative;
          overflow: hidden;
        }
        .voice-hero-card::before {
          content: '';
          position: absolute;
          top: -80px;
          left: 50%;
          transform: translateX(-50%);
          width: 320px;
          height: 160px;
          background: radial-gradient(circle, rgba(99, 102, 241, 0.3) 0%, transparent 70%);
          pointer-events: none;
        }
        .hero-prompt-title {
          font-size: 2.2rem;
          font-weight: 800;
          letter-spacing: -0.02em;
          color: #ffffff;
          margin-bottom: 8px;
        }
        .hero-prompt-subtitle {
          font-size: 1.1rem;
          color: #94a3b8;
          max-width: 650px;
          margin: 0 auto 28px;
        }

        /* Interactive Master Mic Button */
        .master-mic-wrap {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          margin-bottom: 24px;
        }
        .master-mic-btn {
          position: relative;
          width: 90px;
          height: 90px;
          border-radius: 50%;
          border: 3px solid rgba(255, 255, 255, 0.15);
          background: linear-gradient(135deg, #4f46e5 0%, #3b82f6 100%);
          color: white;
          font-size: 38px;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
          box-shadow: 0 10px 25px rgba(79, 70, 229, 0.45);
        }
        .master-mic-btn:hover {
          transform: scale(1.05);
          box-shadow: 0 14px 32px rgba(79, 70, 229, 0.6);
        }
        .master-mic-btn.active {
          background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
          border-color: #fca5a5;
          box-shadow: 0 0 0 8px rgba(239, 68, 68, 0.25), 0 12px 30px rgba(239, 68, 68, 0.6);
          animation: micPulse 1.6s infinite ease-in-out;
        }
        @keyframes micPulse {
          0% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.5), 0 10px 25px rgba(239, 68, 68, 0.4); }
          70% { box-shadow: 0 0 0 18px rgba(239, 68, 68, 0), 0 10px 25px rgba(239, 68, 68, 0.4); }
          100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0), 0 10px 25px rgba(239, 68, 68, 0.4); }
        }
        .mic-shortcut-hint {
          font-size: 0.8rem;
          color: #94a3b8;
          margin-top: 10px;
          font-weight: 500;
        }
        .mic-state-pill {
          margin-top: 10px;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 6px 16px;
          border-radius: 20px;
          font-size: 0.9rem;
          font-weight: 600;
          background: rgba(255, 255, 255, 0.06);
          border: 1px solid rgba(255, 255, 255, 0.1);
        }
        .mic-state-pill.listening {
          background: rgba(239, 68, 68, 0.15);
          border-color: rgba(239, 68, 68, 0.4);
          color: #fca5a5;
        }
        .mic-state-pill.ready {
          background: rgba(56, 189, 248, 0.12);
          border-color: rgba(56, 189, 248, 0.3);
          color: #38bdf8;
        }

        /* Hero Live Feedback */
        .hero-feedback-box {
          max-width: 650px;
          margin: 0 auto 20px;
        }
        .transcript-bubble {
          background: rgba(99, 102, 241, 0.12);
          border: 1px solid rgba(99, 102, 241, 0.3);
          padding: 12px 18px;
          border-radius: 12px;
          font-size: 1rem;
          color: #e0e7ff;
          margin-bottom: 8px;
          text-align: left;
        }
        .last-action-bubble {
          background: rgba(14, 165, 233, 0.1);
          border: 1px solid rgba(14, 165, 233, 0.25);
          padding: 8px 14px;
          border-radius: 10px;
          font-size: 0.9rem;
          color: #7dd3fc;
          text-align: left;
        }
        .alert-box {
          padding: 12px 18px;
          border-radius: 12px;
          margin: 12px 0;
          text-align: left;
          font-weight: 500;
        }
        .alert-error {
          background: rgba(239, 68, 68, 0.15);
          border: 1px solid rgba(239, 68, 68, 0.4);
          color: #fca5a5;
        }

        /* Fallback input bar in hero */
        .hero-input-form {
          max-width: 680px;
          margin: 0 auto;
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }
        .hero-text-input {
          flex: 1;
          min-width: 260px;
          background: rgba(15, 23, 42, 0.8);
          border: 1px solid rgba(255, 255, 255, 0.15);
          border-radius: 12px;
          padding: 14px 18px;
          color: #ffffff;
          font-size: 1.05rem;
          transition: border-color 0.2s ease;
        }
        .hero-text-input:focus {
          border-color: #6366f1;
        }
        .primary-action-btn {
          background: linear-gradient(135deg, #4f46e5 0%, #6366f1 100%);
          color: white;
          border: none;
          padding: 14px 24px;
          border-radius: 12px;
          font-size: 1.02rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s ease;
          display: inline-flex;
          align-items: center;
          gap: 6px;
        }
        .primary-action-btn:hover {
          opacity: 0.92;
          transform: translateY(-1px);
        }

        /* Quick Action Chips */
        .quick-chips-row {
          display: flex;
          justify-content: center;
          flex-wrap: wrap;
          gap: 8px;
          margin-top: 18px;
        }
        .quick-chip {
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.1);
          color: #cbd5e1;
          padding: 8px 14px;
          border-radius: 50px;
          font-size: 0.88rem;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s ease;
          display: inline-flex;
          align-items: center;
          gap: 6px;
        }
        .quick-chip:hover {
          background: rgba(99, 102, 241, 0.15);
          border-color: rgba(99, 102, 241, 0.4);
          color: #ffffff;
        }

        /* 3. Navigation Workspace */
        .workspace-card {
          background: rgba(18, 22, 44, 0.75);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 18px;
          padding: 24px;
          margin-bottom: 28px;
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
        }
        .section-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          flex-wrap: wrap;
          gap: 12px;
          margin-bottom: 18px;
        }
        .section-title {
          font-size: 1.35rem;
          font-weight: 700;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .segmented-mode-nav {
          display: inline-flex;
          background: rgba(15, 23, 42, 0.7);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 12px;
          padding: 4px;
          gap: 4px;
        }
        .segmented-mode-btn {
          border: none;
          background: transparent;
          color: #94a3b8;
          padding: 8px 16px;
          border-radius: 8px;
          font-size: 0.92rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s ease;
        }
        .segmented-mode-btn.active {
          background: #4f46e5;
          color: white;
          box-shadow: 0 2px 8px rgba(79, 70, 229, 0.4);
        }

        /* Real GPS Status Banner */
        .gps-status-banner {
          background: rgba(15, 23, 42, 0.6);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 12px;
          padding: 12px 16px;
          margin-bottom: 16px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          flex-wrap: wrap;
          gap: 10px;
        }
        .gps-info-cluster {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .status-dot {
          width: 10px;
          height: 10px;
          border-radius: 50%;
        }
        .status-dot.active { background: #10b981; box-shadow: 0 0 8px #10b981; }
        .status-dot.locating { background: #38bdf8; animation: dotPulse 1.2s infinite; }
        .status-dot.error { background: #ef4444; }
        .status-dot.inactive { background: #94a3b8; }
        @keyframes dotPulse {
          0% { transform: scale(0.8); opacity: 0.5; }
          50% { transform: scale(1.3); opacity: 1; }
          100% { transform: scale(0.8); opacity: 0.5; }
        }

        /* Active Navigation Route Box */
        .active-route-box {
          background: rgba(14, 165, 233, 0.08);
          border: 1px solid rgba(14, 165, 233, 0.25);
          border-radius: 14px;
          padding: 18px 20px;
          margin-top: 18px;
        }
        .active-route-meta {
          display: flex;
          gap: 20px;
          flex-wrap: wrap;
          margin: 10px 0;
          font-size: 1rem;
        }
        .current-step-display {
          background: rgba(15, 23, 42, 0.6);
          border-left: 4px solid #38bdf8;
          border-radius: 10px;
          padding: 14px 18px;
          margin-top: 12px;
        }
        .route-controls-row {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
          margin-top: 14px;
        }

        /* 4. Live Assistance Section */
        .live-assistance-card {
          background: rgba(18, 22, 44, 0.75);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 18px;
          padding: 24px;
          margin-bottom: 28px;
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
        }
        .assistive-disclaimer {
          font-size: 0.85rem;
          color: #94a3b8;
          margin-bottom: 16px;
          padding: 8px 12px;
          background: rgba(255, 255, 255, 0.03);
          border-radius: 8px;
          border-left: 3px solid #6366f1;
        }
        .live-camera-wrap {
          margin: 16px 0;
          border-radius: 14px;
          overflow: hidden;
          background: #000;
          position: relative;
        }
        .camera-video-feed {
          width: 100%;
          max-height: 380px;
          object-fit: cover;
          display: block;
        }
        .action-btn-row {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
          margin: 14px 0;
        }
        .secondary-btn {
          background: rgba(255, 255, 255, 0.06);
          border: 1px solid rgba(255, 255, 255, 0.15);
          color: #f1f5f9;
          padding: 12px 20px;
          border-radius: 12px;
          font-size: 0.95rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s ease;
          display: inline-flex;
          align-items: center;
          gap: 6px;
        }
        .secondary-btn:hover {
          background: rgba(255, 255, 255, 0.12);
        }
        .danger-action-btn {
          background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
          color: white;
          border: none;
          padding: 12px 20px;
          border-radius: 12px;
          font-size: 0.95rem;
          font-weight: 600;
          cursor: pointer;
        }

        /* 5. Collapsible Advanced Tools */
        .advanced-tools-card {
          background: rgba(15, 23, 42, 0.5);
          border: 1px solid rgba(255, 255, 255, 0.07);
          border-radius: 16px;
          overflow: hidden;
          margin-top: 36px;
        }
        .advanced-tools-header-btn {
          width: 100%;
          background: transparent;
          border: none;
          padding: 18px 24px;
          color: #f1f5f9;
          display: flex;
          align-items: center;
          justify-content: space-between;
          cursor: pointer;
          text-align: left;
        }
        .advanced-tools-header-btn:hover {
          background: rgba(255, 255, 255, 0.02);
        }
        .advanced-tools-body {
          padding: 0 24px 24px;
          border-top: 1px solid rgba(255, 255, 255, 0.05);
        }
        .tools-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
          gap: 16px;
          margin-top: 16px;
        }
        .tool-subcard {
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 12px;
          padding: 16px;
        }
        .tool-subcard h3 {
          font-size: 1rem;
          font-weight: 600;
          margin-bottom: 10px;
          display: flex;
          align-items: center;
          gap: 6px;
        }

        /* 6. Accessible Voice Commands Help Modal */
        .modal-backdrop {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.75);
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
          z-index: 9999;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
        }
        .modal-content-card {
          background: #0f132a;
          border: 1px solid rgba(99, 102, 241, 0.3);
          border-radius: 20px;
          max-width: 650px;
          width: 100%;
          max-height: 85vh;
          overflow-y: auto;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.7);
          padding: 28px;
        }
        .modal-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          border-bottom: 1px solid rgba(255, 255, 255, 0.1);
          padding-bottom: 14px;
          margin-bottom: 20px;
        }
        .modal-title {
          font-size: 1.35rem;
          font-weight: 700;
        }
        .modal-close-btn {
          background: rgba(255, 255, 255, 0.08);
          border: none;
          color: #f1f5f9;
          font-size: 1.2rem;
          width: 36px;
          height: 36px;
          border-radius: 50%;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .help-category {
          margin-bottom: 20px;
        }
        .help-cat-title {
          font-size: 1rem;
          font-weight: 700;
          color: #a5b4fc;
          margin-bottom: 8px;
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .help-command-list {
          list-style: none;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .help-command-item {
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(255, 255, 255, 0.06);
          border-radius: 8px;
          padding: 8px 12px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 10px;
          font-size: 0.92rem;
        }
        .help-command-item code {
          color: #38bdf8;
          font-weight: 600;
        }

        /* Mobile Adjustments */
        @media (max-width: 640px) {
          .hero-prompt-title { font-size: 1.7rem; }
          .hero-prompt-subtitle { font-size: 0.95rem; }
          .master-mic-btn { width: 78px; height: 78px; font-size: 32px; }
          .workspace-card, .live-assistance-card, .voice-hero-card { padding: 18px 14px; }
          .hero-input-form { flex-direction: column; }
          .primary-action-btn { width: 100%; justify-content: center; }
        }
      `}</style>

      {/* Accessible Skip Link */}
      <a href="#main-voice-hero" className="skip-link">
        {t("skip_to_content")}
      </a>

      <div className="app-container">
        {/* Top Header Bar */}
        <header className="app-header" role="banner">
          <div className="brand-cluster">
            <div className="brand-icon" aria-hidden="true">
              <IconEye size={24} style={{ color: "#38bdf8" }} />
            </div>
            <div className="brand-text">
              <h1>{t("app_name")}</h1>
              <div className="brand-tagline">{t("app_tagline_refined") || t("app_tagline")}</div>
            </div>
          </div>

          <div className="header-actions">
            {/* Language Selector */}
            <div className="lang-select-wrap">
              <IconWorld size={18} aria-hidden="true" style={{ color: "#94a3b8" }} />
              <label htmlFor="header-lang-select" className="sr-only" style={{ display: "none" }}>
                {t("select_language")}
              </label>
              <select
                id="header-lang-select"
                className="header-lang-select"
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

            {/* Accessible Voice Help Button */}
            <button
              type="button"
              className="icon-btn"
              onClick={() => setIsHelpOpen(true)}
              aria-label={t("help_dialog_title") || "Supported Voice Commands"}
              aria-haspopup="dialog"
            >
              <IconHelp size={18} aria-hidden="true" /> <span>{t("cmd_help") ? t("cmd_help").replace(/"/g, "") : "Help"}</span>
            </button>
          </div>
        </header>

        <div className="app-shell">
          {/* Main Hero: Voice Navigation Experience */}
          <section id="main-voice-hero" className="voice-hero-card" aria-label="Voice Navigation Hero">
            <h2 className="hero-prompt-title">
              {t("hero_prompt_title") || "Where would you like to go?"}
            </h2>
            <p className="hero-prompt-subtitle">
              {t("hero_prompt_subtitle") || "Speak your destination or ask Dhristi to describe your surroundings."}
            </p>

            {/* Central Master Microphone Controller */}
            <div className="master-mic-wrap">
              <button
                type="button"
                className={`master-mic-btn ${isVoiceControlActive ? "active" : ""}`}
                onClick={toggleVoiceSession}
                aria-label={isVoiceControlActive ? t("stop_voice_listening") : t("enable_voice_commands")}
                title={isVoiceControlActive ? "Stop voice listening (Alt+V)" : "Start voice listening (Alt+V)"}
              >
                {isVoiceControlActive ? (
                  <IconPlayerStop size={32} stroke={2.2} aria-hidden="true" />
                ) : (
                  <IconMicrophone size={32} stroke={2.2} aria-hidden="true" />
                )}
              </button>

              <div
                className={`mic-state-pill ${isVoiceControlActive ? "listening" : "ready"}`}
                aria-live="polite"
              >
                {isVoiceControlActive
                  ? `${t("listening_for_commands") || "Listening for commands..."}`
                  : `${t("mic_off") || "Microphone Off"} — Tap to Speak`}
              </div>
              <div className="mic-shortcut-hint">Keyboard shortcut: Alt+V</div>
            </div>

            {/* Real-time Voice Recognition Feedback */}
            <div className="hero-feedback-box" aria-live="polite">
              {liveTranscript && (
                <div className="transcript-bubble">
                  <strong>{t("heard")}:</strong> "{liveTranscript}"
                </div>
              )}
              {lastExecutedCommand && (
                <div className="last-action-bubble">
                  <IconBolt size={16} aria-hidden="true" style={{ verticalAlign: "middle", marginRight: 4 }} />
                  <strong>{t("last_action")}:</strong> {lastExecutedCommand}
                </div>
              )}
              {speechError && (
                <div className="alert-box alert-error" role="alert" aria-live="assertive">
                  <IconInfoCircle size={18} aria-hidden="true" style={{ verticalAlign: "middle", marginRight: 6 }} />
                  {speechError}
                </div>
              )}
            </div>

            {/* Destination / Command Fallback Input */}
            <form className="hero-input-form" onSubmit={handleFallbackSubmit}>
              <input
                type="text"
                className="hero-text-input"
                placeholder={t("destination_input_placeholder")}
                value={manualDestination}
                onChange={(e) => setManualDestination(e.target.value)}
                aria-label={t("destination_input_aria")}
              />
              <button
                type="submit"
                className="primary-action-btn"
                disabled={!manualDestination.trim()}
                aria-label={t("btn_navigate")}
              >
                <IconCompass size={18} aria-hidden="true" />
                <span>{t("btn_navigate")}</span>
              </button>
            </form>

            {/* Quick Action Suggestion Chips */}
            <div className="quick-chips-row" role="group" aria-label="Suggested Voice Commands">
              <button
                type="button"
                className="quick-chip"
                onClick={() => handleVoiceCommand({ type: "DESCRIBE_AROUND" })}
              >
                <IconEye size={16} aria-hidden="true" />
                <span>{t("cmd_what_around") ? t("cmd_what_around").replace(/"/g, "") : "What is around me?"}</span>
              </button>
              <button
                type="button"
                className="quick-chip"
                onClick={() => handleVoiceCommand({ type: "READ_TEXT" })}
              >
                <IconBook size={16} aria-hidden="true" />
                <span>{t("cmd_read_text") ? t("cmd_read_text").replace(/"/g, "") : "Read sign"}</span>
              </button>
              <button
                type="button"
                className="quick-chip"
                onClick={() => navigationManagerRef.current?.repeatInstruction()}
              >
                <IconRotateClockwise size={16} aria-hidden="true" />
                <span>{t("cmd_repeat") ? t("cmd_repeat").replace(/"/g, "") : "Repeat instruction"}</span>
              </button>
              <button
                type="button"
                className="quick-chip"
                onClick={() => speakText(t("messages.onboarding"))}
              >
                <IconVolume size={16} aria-hidden="true" />
                <span>{t("repeat_onboarding") || "Spoken Guide"}</span>
              </button>
              {navigationState.isNavigating && (
                <button
                  type="button"
                  className="quick-chip"
                  style={{ borderColor: "#f87171", color: "#fca5a5" }}
                  onClick={stopNavigation}
                >
                  <IconSquareX size={16} aria-hidden="true" />
                  <span>{t("btn_stop_nav")}</span>
                </button>
              )}
            </div>
          </section>

          {/* Navigation Workspace */}
          <section className="workspace-card" aria-label="Navigation Workspace">
            <div className="section-header">
              <div className="section-title">
                <IconWalk size={22} aria-hidden="true" />
                <span>{t("nav_title")}</span>
              </div>

              {/* Segmented Mode Selector */}
              <div className="segmented-mode-nav" role="tablist" aria-label="Navigation Mode">
                <button
                  type="button"
                  role="tab"
                  aria-selected={navigationMode === "outdoor"}
                  className={`segmented-mode-btn ${navigationMode === "outdoor" ? "active" : ""}`}
                  onClick={() => setNavigationMode("outdoor")}
                >
                  <IconSatellite size={16} aria-hidden="true" />
                  <span>{t("mode_outdoor")}</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={navigationMode === "indoor"}
                  className={`segmented-mode-btn ${navigationMode === "indoor" ? "active" : ""}`}
                  onClick={() => setNavigationMode("indoor")}
                >
                  <IconBuilding size={16} aria-hidden="true" />
                  <span>{t("mode_indoor")}</span>
                </button>
              </div>
            </div>

            {navigationMode === "outdoor" ? (
              <>
                {/* Real GPS Status Banner */}
                <div className="gps-status-banner" aria-live="polite">
                  <div className="gps-info-cluster">
                    <div
                      className={`status-dot ${
                        userLocation && !userLocation.isDemo
                          ? "active"
                          : locationStatus === "LOCATING"
                          ? "locating"
                          : locationStatus === "DENIED" || locationStatus === "UNAVAILABLE"
                          ? "error"
                          : "inactive"
                      }`}
                      aria-hidden="true"
                    />
                    <div>
                      <strong>
                        {locationStatus === "LOCATING"
                          ? t("gps_locating") || "Locating your position…"
                          : userLocation?.isDemo
                          ? t("demo_origin_active") || "Demo GPS Active (Testing Mode)"
                          : userLocation
                          ? `${t("gps_available") || "Current location available"} (±${Math.round(userLocation.accuracy || 0)}m)`
                          : locationStatus === "DENIED"
                          ? t("gps_permission_required") || "Location permission required"
                          : locationStatus === "TIMEOUT"
                          ? t("gps_timeout") || "Location request timed out"
                          : t("gps_unavailable") || "Location unavailable"}
                      </strong>
                      {userLocation && !userLocation.isDemo && (
                        <div style={{ fontSize: "0.82rem", color: "#94a3b8" }}>
                          GPS: {userLocation.latitude.toFixed(5)}, {userLocation.longitude.toFixed(5)}
                        </div>
                      )}
                    </div>
                  </div>

                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => requestDeviceLocation(false)}
                    aria-label="Refresh real GPS location"
                  >
                    <IconRefresh size={16} aria-hidden="true" />
                    <span>{t("gps_refresh") || "Refresh Location"}</span>
                  </button>
                </div>

                {/* Leaflet Outdoor Map */}
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
                  locationStatus={locationStatus}
                  onRequestLocation={() => requestDeviceLocation(false)}
                  onSelectCategory={(categoryQuery) => {
                    setManualDestination(categoryQuery);
                    initiateNavigation(categoryQuery);
                  }}
                  onSelectDestination={(dest) => {
                    const label = dest.name || `${dest.latitude.toFixed(4)}, ${dest.longitude.toFixed(4)}`;
                    setManualDestination(label);
                    initiateNavigation(dest);
                  }}
                  onNextStep={() => navigationManagerRef.current?.nextStep()}
                  onRepeatInstruction={() => navigationManagerRef.current?.repeatInstruction()}
                />

                {/* Active Route Turn-by-Turn Card */}
                {navigationState.isNavigating && (
                  <div className="active-route-box" aria-live="polite">
                    <div style={{ fontSize: "1.1rem", fontWeight: "700", color: "#38bdf8" }}>
                      <IconWalk size={20} aria-hidden="true" style={{ verticalAlign: "middle", marginRight: 6 }} />
                      {t("navigating_to")} {navigationState.destination?.name || t("destination")}
                    </div>
                    {navigationState.destination?.address && (
                      <div style={{ fontSize: "0.9rem", color: "#94a3b8", marginTop: "2px" }}>
                        <IconMapPin size={16} aria-hidden="true" style={{ verticalAlign: "middle", marginRight: 4 }} />
                        {navigationState.destination.address}
                      </div>
                    )}
                    <div className="active-route-meta">
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
                      <div className="current-step-display">
                        <div style={{ fontSize: "0.85rem", color: "#a5b4fc", fontWeight: 600 }}>
                          {t("current_spoken_step")}
                        </div>
                        <div style={{ fontSize: "1.2rem", fontWeight: 700, marginTop: "4px" }}>
                          {navigationState.currentStep.instruction}
                        </div>
                      </div>
                    )}

                    <div className="route-controls-row">
                      <button
                        type="button"
                        className="primary-action-btn"
                        onClick={() => navigationManagerRef.current?.nextStep()}
                        aria-label="Advance to next step"
                      >
                        <IconPlayerTrackNext size={18} aria-hidden="true" />
                        <span>{t("btn_next_step") || "Next Step"}</span>
                      </button>
                      <button
                        type="button"
                        className="secondary-btn"
                        onClick={() => navigationManagerRef.current?.repeatInstruction()}
                        aria-label="Repeat last instruction"
                      >
                        <IconRotateClockwise size={18} aria-hidden="true" />
                        <span>{t("cmd_repeat") ? t("cmd_repeat").replace(/"/g, "") : "Repeat"}</span>
                      </button>
                      <button
                        type="button"
                        className="danger-action-btn"
                        onClick={stopNavigation}
                        aria-label={t("btn_stop_nav")}
                      >
                        <IconPlayerStop size={18} aria-hidden="true" />
                        <span>{t("btn_stop_nav")}</span>
                      </button>
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
                onMarkerApplied={(marker) => console.log("Marker applied:", marker)}
                voiceOrchestratorRef={voiceOrchestratorRef}
                slamControlRef={slamControlRef}
                ocrText={ocrResult}
                isListening={isVoiceControlActive}
                onToggleListening={toggleVoiceControl}
                liveTranscript={liveTranscript}
                lastExecutedCommand={lastExecutedCommand}
              />
            )}
          </section>

          {/* Unified Live Assistance Section */}
          <section className="live-assistance-card" aria-label="Live Assistance">
            <div className="section-header">
              <div className="section-title">
                <IconCamera size={22} aria-hidden="true" />
                <span>{t("live_assistance_title") || t("live_detection_title")}</span>
              </div>
              <span
                className={`mic-state-pill ${
                  detectionState === "DETECTING" || detectionState === "PROCESSING"
                    ? "listening"
                    : detectionState === "STARTING"
                    ? "ready"
                    : ""
                }`}
                aria-live="polite"
              >
                {t("status_label")}: {detectionState}
              </span>
            </div>

            <div className="assistive-disclaimer" role="note">
              <IconInfoCircle size={16} aria-hidden="true" style={{ verticalAlign: "middle", marginRight: 6 }} />
              {t("live_assistance_disclaimer") || "Obstacle detection is an assistive aid and does not guarantee an obstacle-free path. Always rely on primary mobility aids."}
            </div>

            {cameraError && (
              <div className="alert-box alert-error" role="alert" aria-live="assertive">
                <IconInfoCircle size={18} aria-hidden="true" style={{ verticalAlign: "middle", marginRight: 6 }} />
                {cameraError}
              </div>
            )}

            {/* Video preview feed when active */}
            <div
              className="live-camera-wrap"
              style={{
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
                className="camera-video-feed"
                aria-label="Live camera feed for obstacle detection"
              />
              <canvas ref={canvasRef} style={{ display: "none" }} />
            </div>

            {/* Control Actions Row */}
            <div className="action-btn-row">
              {detectionState !== "DETECTING" &&
              detectionState !== "PROCESSING" &&
              detectionState !== "STARTING" ? (
                <button
                  type="button"
                  onClick={startLiveDetection}
                  className="primary-action-btn"
                  aria-label={t("btn_start_live")}
                >
                  <IconPlayerPlay size={18} aria-hidden="true" />
                  <span>{t("btn_start_live")}</span>
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={stopLiveDetection}
                    className="danger-action-btn"
                    aria-label={t("btn_stop_live")}
                  >
                    <IconPlayerStop size={18} aria-hidden="true" />
                    <span>{t("btn_stop_live")}</span>
                  </button>
                  <button
                    type="button"
                    onClick={captureFrameForOCR}
                    className="secondary-btn"
                    aria-label={t("btn_read_signboard")}
                  >
                    <IconBook size={18} aria-hidden="true" />
                    <span>{t("btn_read_signboard")}</span>
                  </button>
                  <button
                    type="button"
                    onClick={describeSurroundings}
                    className="secondary-btn"
                    aria-label={t("btn_what_front")}
                  >
                    <IconCompass size={18} aria-hidden="true" />
                    <span>{t("btn_what_front")}</span>
                  </button>
                </>
              )}
            </div>

            {/* Live Detected Obstacles List */}
            {liveDetections.length > 0 && (
              <div className="active-route-box" style={{ marginTop: 14 }} aria-live="polite">
                <div style={{ fontSize: "1rem", fontWeight: 700, color: "#38bdf8", marginBottom: 8 }}>
                  {t("current_detections_title")}
                </div>
                <ul style={{ listStyle: "none", padding: 0 }}>
                  {liveDetections.map((obj, i) => (
                    <li
                      key={i}
                      style={{
                        background: "rgba(255, 255, 255, 0.05)",
                        padding: "10px 14px",
                        borderRadius: "8px",
                        marginBottom: "6px",
                        borderLeft: obj.distance && obj.distance < 2 ? "4px solid #ef4444" : "4px solid #38bdf8"
                      }}
                    >
                      <strong>{translateObjectLabel(obj.class_name, language)}</strong>
                      {obj.distance && ` — ${obj.distance}${t("meters_away")}`}
                      {obj.direction && ` (${translateDirection(obj.direction, language)})`}
                      {obj.confidence && ` • ${(obj.confidence * 100).toFixed(0)}%`}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          {/* 5. Collapsible Advanced Tools Section */}
          <section className="advanced-tools-card" aria-label="Advanced Tools">
            <button
              type="button"
              className="advanced-tools-header-btn"
              onClick={() => setIsAdvancedToolsOpen(!isAdvancedToolsOpen)}
              aria-expanded={isAdvancedToolsOpen}
              aria-controls="advanced-tools-panel"
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <IconTools size={22} aria-hidden="true" style={{ color: "#38bdf8", flexShrink: 0 }} />
                <div>
                  <div style={{ fontWeight: 700, fontSize: "1.05rem" }}>
                    {t("advanced_tools_title") || "Advanced Tools & Diagnostics"}
                  </div>
                  <div style={{ fontSize: "0.82rem", color: "#94a3b8" }}>
                    {t("advanced_tools_subtitle") || "Manual testing for STT, TTS, static image detection, and simulation."}
                  </div>
                </div>
              </div>
              <IconChevronDown
                size={20}
                aria-hidden="true"
                style={{
                  color: "#94a3b8",
                  transition: "transform 0.2s ease",
                  transform: isAdvancedToolsOpen ? "rotate(180deg)" : "rotate(0)"
                }}
              />
            </button>

            {isAdvancedToolsOpen && (
              <div id="advanced-tools-panel" className="advanced-tools-body">
                <div className="tools-grid">
                  {/* Tool 1: Manual Speech to Text */}
                  <div className="tool-subcard">
                    <h3 style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <IconMicrophone size={18} aria-hidden="true" style={{ color: "#38bdf8" }} />
                      <span>{t("stt_title")}</span>
                    </h3>
                    {isRecording ? (
                      <button type="button" onClick={handleStopRecording} className="danger-action-btn">
                        <IconPlayerStop size={18} aria-hidden="true" />
                        <span>{t("btn_stop_recording")}</span>
                      </button>
                    ) : (
                      <button type="button" onClick={handleStartRecording} className="secondary-btn">
                        <IconPlayerPlay size={18} aria-hidden="true" />
                        <span>{t("btn_start_recording")}</span>
                      </button>
                    )}
                    {sttResult && (
                      <div style={{ marginTop: 10, fontSize: "0.9rem", color: "#cbd5e1" }}>
                        <strong>{t("transcribed_text_title")}:</strong> {sttResult}
                      </div>
                    )}
                  </div>

                  {/* Tool 2: Manual Text to Speech */}
                  <div className="tool-subcard">
                    <h3 style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <IconVolume size={18} aria-hidden="true" style={{ color: "#38bdf8" }} />
                      <span>{t("tts_title")}</span>
                    </h3>
                    <textarea
                      style={{
                        width: "100%",
                        minHeight: "70px",
                        background: "rgba(0,0,0,0.3)",
                        border: "1px solid rgba(255,255,255,0.15)",
                        borderRadius: "8px",
                        padding: "8px",
                        color: "#fff",
                        fontSize: "0.9rem"
                      }}
                      placeholder={t("tts_placeholder")}
                      value={ttsText}
                      onChange={(e) => setTtsText(e.target.value)}
                    />
                    <button
                      type="button"
                      onClick={handleTTS}
                      className="secondary-btn"
                      style={{ marginTop: 8 }}
                    >
                      <IconVolume size={18} aria-hidden="true" />
                      <span>{t("btn_speak_text")}</span>
                    </button>
                  </div>

                  {/* Tool 3: Static Image Object Detection */}
                  <div className="tool-subcard">
                    <h3 style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <IconEye size={18} aria-hidden="true" style={{ color: "#38bdf8" }} />
                      <span>{t("static_detect_title")}</span>
                    </h3>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleObjectDetection}
                      id="static-obj-file"
                      style={{ fontSize: "0.85rem", color: "#94a3b8" }}
                    />
                    {objectResult.length > 0 && (
                      <ul style={{ marginTop: 8, fontSize: "0.85rem", listStyle: "none", padding: 0 }}>
                        {objectResult.map((o, idx) => (
                          <li key={idx}>
                            • {translateObjectLabel(o.class_name, language)}: {(o.confidence * 100).toFixed(1)}%
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  {/* Tool 4: Manual OCR Upload */}
                  <div className="tool-subcard">
                    <h3 style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <IconBook size={18} aria-hidden="true" style={{ color: "#38bdf8" }} />
                      <span>{t("ocr_title")}</span>
                    </h3>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleOCR}
                      id="static-ocr-file"
                      style={{ fontSize: "0.85rem", color: "#94a3b8" }}
                    />
                    {ocrResult && (
                      <div style={{ marginTop: 8, fontSize: "0.85rem", color: "#cbd5e1" }}>
                        <strong>{t("extracted_text_title")}:</strong> {ocrResult}
                      </div>
                    )}
                  </div>

                  {/* Tool 5: Testing Only Demo Origin Simulator */}
                  <div className="tool-subcard" style={{ borderColor: "rgba(245, 158, 11, 0.4)" }}>
                    <h3 style={{ color: "#fbbf24", display: "flex", alignItems: "center", gap: 8 }}>
                      <IconCrosshair size={18} aria-hidden="true" style={{ color: "#fbbf24" }} />
                      <span>{t("demo_origin_test_btn") || "[Testing Only] Set Demo GPS"}</span>
                    </h3>
                    <p style={{ fontSize: "0.82rem", color: "#94a3b8", marginBottom: 10 }}>
                      Sets location to Mysuru City Center strictly for indoor testing when real GPS movement is not possible.
                    </p>
                    <button
                      type="button"
                      className="secondary-btn"
                      onClick={() => {
                        setUserLocation(DEMO_TEST_ORIGIN);
                        setLocationStatus("ACTIVE");
                        speakText(t("messages.demoGpsSet"));
                      }}
                    >
                      <IconCrosshair size={18} aria-hidden="true" />
                      <span>{t("demo_origin_test_btn") || "Set Demo Origin (Mysuru)"}</span>
                    </button>
                  </div>
                </div>
              </div>
            )}
          </section>
        </div>

        {/* 6. Accessible Voice Commands Help Modal Dialog */}
        {isHelpOpen && (
          <div
            className="modal-backdrop"
            onClick={(e) => {
              if (e.target === e.currentTarget) setIsHelpOpen(false);
            }}
            role="presentation"
          >
            <div
              className="modal-content-card"
              role="dialog"
              aria-modal="true"
              aria-labelledby="help-dialog-title"
            >
              <div className="modal-header">
                <h2 id="help-dialog-title" className="modal-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <IconHelp size={22} aria-hidden="true" style={{ color: "#38bdf8" }} />
                  <span>{t("help_dialog_title") || t("supported_commands_title")}</span>
                </h2>
                <button
                  type="button"
                  className="modal-close-btn"
                  onClick={() => setIsHelpOpen(false)}
                  aria-label={t("help_dialog_close") || "Close"}
                >
                  <IconX size={20} aria-hidden="true" />
                </button>
              </div>

              {/* Navigation Commands */}
              <div className="help-category">
                <div className="help-cat-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <IconCompass size={18} aria-hidden="true" style={{ color: "#38bdf8" }} />
                  <span>{t("help_nav_category") || "Navigation Commands"}</span>
                </div>
                <ul className="help-command-list">
                  <li className="help-command-item">
                    <code>"Take me to [place]"</code>
                    <span>Calculates walking route</span>
                  </li>
                  <li className="help-command-item">
                    <code>"Stop navigation"</code>
                    <span>Stops active guidance</span>
                  </li>
                  <li className="help-command-item">
                    <code>"Pause / Resume"</code>
                    <span>Pauses or resumes guidance</span>
                  </li>
                  <li className="help-command-item">
                    <code>"Next step"</code>
                    <span>Advances to next turn</span>
                  </li>
                  <li className="help-command-item">
                    <code>"Repeat instruction"</code>
                    <span>Repeats the last spoken step</span>
                  </li>
                  <li className="help-command-item">
                    <code>"Where am I?"</code>
                    <span>Reports current GPS location</span>
                  </li>
                </ul>
              </div>

              {/* Assistance Commands */}
              <div className="help-category">
                <div className="help-cat-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <IconEye size={18} aria-hidden="true" style={{ color: "#38bdf8" }} />
                  <span>{t("help_vision_category") || "Assistance & Perception"}</span>
                </div>
                <ul className="help-command-list">
                  <li className="help-command-item">
                    <code>"What is around me?"</code>
                    <span>Summary of objects in view</span>
                  </li>
                  <li className="help-command-item">
                    <code>"Read this" / "Read sign"</code>
                    <span>Reads text using live camera</span>
                  </li>
                  <li className="help-command-item">
                    <code>"Start / Stop detection"</code>
                    <span>Toggles camera & obstacle detector</span>
                  </li>
                </ul>
              </div>

              {/* Language Commands */}
              <div className="help-category">
                <div className="help-cat-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <IconWorld size={18} aria-hidden="true" style={{ color: "#38bdf8" }} />
                  <span>{t("help_lang_category") || "Language & System"}</span>
                </div>
                <ul className="help-command-list">
                  <li className="help-command-item">
                    <code>"Change language to Kannada"</code>
                    <span>Switches to Kannada & neural voice</span>
                  </li>
                  <li className="help-command-item">
                    <code>"Malayalam / Hindi / Tamil / Telugu"</code>
                    <span>Switches to regional language</span>
                  </li>
                  <li className="help-command-item">
                    <code>"Help"</code>
                    <span>Spoken summary of commands</span>
                  </li>
                </ul>
              </div>

              <button
                type="button"
                className="primary-action-btn"
                style={{ width: "100%", justifyContent: "center", marginTop: 10 }}
                onClick={() => setIsHelpOpen(false)}
              >
                <IconX size={18} aria-hidden="true" />
                <span>{t("help_dialog_close") || "Close Help"}</span>
              </button>
            </div>
          </div>
        )}
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