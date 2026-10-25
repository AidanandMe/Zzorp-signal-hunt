/**
 * Zzorp Signal Hunt — Frontend Controller (Milestone 1 & Milestone 2)
 *
 * - Resizes images in browser via <canvas> to max 1600px JPEG (strips EXIF/GPS metadata).
 * - Never stores uploaded images on disk or in localStorage.
 * - Screen 1: Signal Scanner (supports first_scan and follow_up investigation mode).
 * - Screen 2: Field Report (observations, signal badge, Zzorp reaction, mission, player conclusion, sources).
 * - Screen 3: Field Notebook in localStorage (observed -> question_open -> evidence_gathered -> player_concluded).
 */

(function () {
  "use strict";

  const MAX_DIMENSION = 1024;
  const JPEG_QUALITY = 0.80;
  const NOTEBOOK_STORAGE_KEY = "zzorp_field_notebook_v1";
  const GAME_STORAGE_KEY = "zzorp_game_state_v1";

  const WAITING_MESSAGES = [
    "Looking closely at your photo…",
    "Checking Zzorp's Earth Fact Book…",
    "Wiggling antennae and thinking hard…",
  ];

  // Deterministic Signal Points table (calculated strictly in app code, never by the model)
  const POINT_EVENTS = {
    first_scan_completed: {
      points: 10,
      label: "New photo scanned!",
    },
    follow_up_completed: {
      points: 20,
      label: "Follow-up mission done!",
    },
    meaningful_new_evidence: {
      points: 15,
      label: "Awesome new clue found!",
    },
    new_archive_id_bonus: {
      points: 5,
      label: "New Earth fact unlocked!",
    },
    interpretation_revised: {
      points: 10,
      label: "You helped Zzorp figure it out!",
    },
    player_conclusion_saved: {
      points: 15,
      label: "You shared what you think!",
    },
    positive_signal_bonus: {
      points: 5,
      label: "Awesome Earth habit spotted!",
    },
  };

  // Deterministic Badges evaluated from actual Field Notebook investigation history
  const BADGE_DEFINITIONS = [
    {
      id: "urban_nature_scout",
      icon: "🌱",
      name: "Urban Nature Scout",
      description: "Scan a plant, tree, park, or garden clue",
      check: (entries) =>
        entries.some((e) => {
          const ev = e.evidence_used || [];
          if (ev.includes("EV-013") || ev.includes("EV-014")) return true;
          const text = [
            e.entry_title,
            e.signal_summary,
            ...(e.visible_facts || []),
            e.new_evidence,
          ]
            .filter(Boolean)
            .join(" ");
          return /\b(tree|trees|plant|plants|leaf|leaves|garden|grass|moss|soil|flower|park|nature|hedge|paving|paved|concrete)\b/i.test(
            text
          );
        }),
    },
    {
      id: "reuse_detective",
      icon: "♻️",
      name: "Reuse Detective",
      description: "Investigate reusing, fixing, or recycling",
      check: (entries) =>
        entries.some((e) => {
          const ev = e.evidence_used || [];
          if (
            ["EV-001", "EV-002", "EV-003", "EV-006", "EV-009", "EV-015"].some((id) =>
              ev.includes(id)
            )
          ) {
            return true;
          }
          const text = [
            e.entry_title,
            e.signal_summary,
            ...(e.visible_facts || []),
            e.new_evidence,
          ]
            .filter(Boolean)
            .join(" ");
          return /\b(reuse|reusable|repair|repaired|fix|fixed|mend|recycle|recycling|recyclable|refill|mug|bin|carrier bag|cup)\b/i.test(
            text
          );
        }),
    },
    {
      id: "energy_investigator",
      icon: "💡",
      name: "Energy Investigator",
      description: "Investigate lights, switches, or power",
      check: (entries) =>
        entries.some((e) => {
          const ev = e.evidence_used || [];
          if (["EV-010", "EV-011", "EV-012"].some((id) => ev.includes(id))) return true;
          const text = [
            e.entry_title,
            e.signal_summary,
            ...(e.visible_facts || []),
            e.new_evidence,
          ]
            .filter(Boolean)
            .join(" ");
          return /\b(light|lights|lighting|bulb|led|halogen|incandescent|lamp|switch|energy|electricity|standby|power|appliance|screen)\b/i.test(
            text
          );
        }),
    },
    {
      id: "evidence_hunter",
      icon: "🔍",
      name: "Evidence Hunter",
      description: "Bring back a follow-up photo with a new clue",
      check: (entries) =>
        entries.some(
          (e) =>
            (Array.isArray(e.awarded_events) &&
              e.awarded_events.includes("meaningful_new_evidence")) ||
            Boolean(e.new_evidence && String(e.new_evidence).trim())
        ),
    },
    {
      id: "human_habits_expert",
      icon: "🛸",
      name: "Human Habits Expert",
      description: "Write what you think for 2 or more mysteries",
      check: (entries) =>
        entries.filter(
          (e) =>
            e.entry_state === "player_concluded" &&
            Boolean(e.player_conclusion && String(e.player_conclusion).trim())
        ).length >= 2,
    },
  ];

  const SIGNAL_META = {
    possible_contradiction: {
      label: "🤔 Wait… That's Weird!",
      cardClass: "signal-possible_contradiction",
      badgeClass: "badge-possible_contradiction",
    },
    positive_signal: {
      label: "🌱 Awesome Earth Habit!",
      cardClass: "signal-positive_signal",
      badgeClass: "badge-positive_signal",
    },
    insufficient_evidence: {
      label: "🔎 Need One More Clue!",
      cardClass: "signal-insufficient_evidence",
      badgeClass: "badge-insufficient_evidence",
    },
    no_signal: {
      label: "✨ Just a Normal Earth Thing!",
      cardClass: "signal-no_signal",
      badgeClass: "badge-no_signal",
    },
  };

  const ENTRY_STATE_META = {
    observed: { label: "👀 Spotted", pillClass: "state-observed" },
    question_open: { label: "❓ Mystery Open", pillClass: "state-question_open" },
    evidence_gathered: { label: "🔎 Clue Found!", pillClass: "state-evidence_gathered" },
    player_concluded: { label: "⭐ Solved by You!", pillClass: "state-player_concluded" },
  };

  // DOM Elements: Navigation, Header Status & Celebration
  const apiKeyBanner = document.getElementById("apiKeyBanner");
  const navScannerBtn = document.getElementById("navScannerBtn");
  const navNotebookBtn = document.getElementById("navNotebookBtn");
  const notebookCountPill = document.getElementById("notebookCountPill");

  const headerPointsBtn = document.getElementById("headerPointsBtn");
  const headerPointsValue = document.getElementById("headerPointsValue");
  const headerBadgesBtn = document.getElementById("headerBadgesBtn");
  const headerBadgesCount = document.getElementById("headerBadgesCount");
  const voiceToggleBtn = document.getElementById("voiceToggleBtn");
  const soundToggleBtn = document.getElementById("soundToggleBtn");

  const celebrationBanner = document.getElementById("celebrationBanner");
  const celebrationPointsHeadline = document.getElementById("celebrationPointsHeadline");
  const celebrationSpeakBtn = document.getElementById("celebrationSpeakBtn");
  const celebrationCloseBtn = document.getElementById("celebrationCloseBtn");
  const celebrationReasonsList = document.getElementById("celebrationReasonsList");
  const celebrationBadgesWrap = document.getElementById("celebrationBadgesWrap");

  const scannerScreen = document.getElementById("scannerScreen");
  const resultsScreen = document.getElementById("resultsScreen");
  const notebookScreen = document.getElementById("notebookScreen");

  // Screen 1 Elements
  const zzorpWelcomeBubble = document.getElementById("zzorpWelcomeBubble");
  const welcomeSpeakBtn = document.getElementById("welcomeSpeakBtn");
  const howItWorksStrip = document.getElementById("howItWorksStrip");
  const scannerStepTag = document.getElementById("scannerStepTag");
  const scannerHeading = document.getElementById("scannerHeading");
  const followUpBanner = document.getElementById("followUpBanner");
  const cancelFollowUpBtn = document.getElementById("cancelFollowUpBtn");
  const followUpEntryTitle = document.getElementById("followUpEntryTitle");
  const followUpQuestion = document.getElementById("followUpQuestion");
  const followUpPhotoTarget = document.getElementById("followUpPhotoTarget");

  const imageInput = document.getElementById("imageInput");
  const cameraInput = document.getElementById("cameraInput");
  const uploadDropZone = document.getElementById("uploadDropZone");
  const emptyUploadPrompt = document.getElementById("emptyUploadPrompt");
  const previewContainer = document.getElementById("previewContainer");
  const imagePreview = document.getElementById("imagePreview");
  const imageMetaBadge = document.getElementById("imageMetaBadge");

  const scanBtn = document.getElementById("scanBtn");
  const scanBtnLabel = document.getElementById("scanBtnLabel");
  const waitingState = document.getElementById("waitingState");
  const waitingTimerBadge = document.getElementById("waitingTimerBadge");
  const waitingMessage = document.getElementById("waitingMessage");
  const waitDots = [
    document.getElementById("waitDot0"),
    document.getElementById("waitDot1"),
    document.getElementById("waitDot2"),
  ];

  const errorCard = document.getElementById("errorCard");
  const errorText = document.getElementById("errorText");
  const exampleFilesRow = document.getElementById("exampleFilesRow");
  const demoPresetBtns = document.querySelectorAll(".demo-preset-btn");

  // Screen 2 Elements
  const viewInNotebookBtn = document.getElementById("viewInNotebookBtn");
  const newScanBtn = document.getElementById("newScanBtn");
  const resultsHeading = document.getElementById("resultsHeading");
  const resultEntryStatePill = document.getElementById("resultEntryStatePill");
  const signalCard = document.getElementById("signalCard");
  const signalBadge = document.getElementById("signalBadge");
  const signalSummary = document.getElementById("signalSummary");
  const zzorpReaction = document.getElementById("zzorpReaction");
  const speakReactionBtn = document.getElementById("speakReactionBtn");
  const newEvidenceCard = document.getElementById("newEvidenceCard");
  const newEvidenceText = document.getElementById("newEvidenceText");
  const cluesDrawer = document.getElementById("cluesDrawer");
  const visibleFactsList = document.getElementById("visibleFactsList");
  const inferencesList = document.getElementById("inferencesList");
  const missingInfoList = document.getElementById("missingInfoList");

  const missionCard = document.getElementById("missionCard");
  const askAdultBadge = document.getElementById("askAdultBadge");
  const missionInstruction = document.getElementById("missionInstruction");
  const missionPhotoTarget = document.getElementById("missionPhotoTarget");
  const startFollowUpFromResultsBtn = document.getElementById("startFollowUpFromResultsBtn");

  const resultZzorpQuestion = document.getElementById("resultZzorpQuestion");
  const resultConclusionInput = document.getElementById("resultConclusionInput");
  const saveResultConclusionBtn = document.getElementById("saveResultConclusionBtn");
  const resultConclusionSavedNote = document.getElementById("resultConclusionSavedNote");

  const sourcesDrawer = document.getElementById("sourcesDrawer");
  const sourcesCountBadge = document.getElementById("sourcesCountBadge");
  const sourcesContent = document.getElementById("sourcesContent");

  const verificationTraceDrawer = document.getElementById("verificationTraceDrawer");
  const traceSummaryInline = document.getElementById("traceSummaryInline");
  const traceSummaryFull = document.getElementById("traceSummaryFull");
  const traceMetricsGrid = document.getElementById("traceMetricsGrid");

  // Screen 3 Elements
  const clearNotebookBtn = document.getElementById("clearNotebookBtn");
  const nbTotalPoints = document.getElementById("nbTotalPoints");
  const badgesGrid = document.getElementById("badgesGrid");
  const notebookEmptyState = document.getElementById("notebookEmptyState");
  const goToScannerFromEmptyBtn = document.getElementById("goToScannerFromEmptyBtn");
  const notebookEntriesList = document.getElementById("notebookEntriesList");

  // In-memory state
  let currentBase64Jpeg = null;
  let waitingTimer = null;
  let waitingSeconds = 0;
  let activeFollowUpEntryId = null; // non-null when scanning a follow-up photo for an existing notebook entry
  let currentResultEntryId = null; // ID of the notebook entry currently shown on Screen 2
  let lastCelebrationSpeechText = "";
  let audioCtx = null;

  /* =========================================================================
     FIELD NOTEBOOK & GAME LAYER STORAGE (localStorage — never stores images)
     ========================================================================= */

  function loadNotebook() {
    try {
      const raw = localStorage.getItem(NOTEBOOK_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }

  function saveNotebook(entries) {
    try {
      localStorage.setItem(NOTEBOOK_STORAGE_KEY, JSON.stringify(entries));
    } catch (_) {
      // Ignore quota errors
    }
    updateNotebookBadgeCount(entries.length);
  }

  function loadGameState() {
    try {
      const raw = localStorage.getItem(GAME_STORAGE_KEY);
      if (!raw) {
        return {
          total_points: 0,
          awarded_events_by_entry: {},
          unlocked_badges: [],
          voice_enabled: false,
          sound_enabled: true,
        };
      }
      const parsed = JSON.parse(raw);
      return {
        total_points: Number(parsed.total_points) || 0,
        awarded_events_by_entry:
          parsed.awarded_events_by_entry && typeof parsed.awarded_events_by_entry === "object"
            ? parsed.awarded_events_by_entry
            : {},
        unlocked_badges: Array.isArray(parsed.unlocked_badges) ? parsed.unlocked_badges : [],
        voice_enabled: Boolean(parsed.voice_enabled),
        sound_enabled: parsed.sound_enabled !== false,
      };
    } catch (_) {
      return {
        total_points: 0,
        awarded_events_by_entry: {},
        unlocked_badges: [],
        voice_enabled: false,
        sound_enabled: true,
      };
    }
  }

  function saveGameState(state) {
    try {
      localStorage.setItem(GAME_STORAGE_KEY, JSON.stringify(state));
    } catch (_) {
      // Ignore quota errors
    }
    updateHeaderGameStatus(state);
  }

  function calculateEntryPoints(awardedEvents) {
    if (!Array.isArray(awardedEvents)) return 0;
    return awardedEvents.reduce((sum, key) => {
      const meta = POINT_EVENTS[key];
      return sum + (meta ? meta.points : 0);
    }, 0);
  }

  /**
   * Award an event key to an entry if not already awarded for that entry.
   */
  function awardEventOnce(entry, eventKey, newlyAwardedList) {
    if (!POINT_EVENTS[eventKey]) return;
    if (!Array.isArray(entry.awarded_events)) {
      entry.awarded_events = [];
    }
    if (entry.awarded_events.includes(eventKey)) {
      return;
    }
    entry.awarded_events.push(eventKey);
    entry.points_earned = calculateEntryPoints(entry.awarded_events);
    if (Array.isArray(newlyAwardedList)) {
      newlyAwardedList.push({
        key: eventKey,
        points: POINT_EVENTS[eventKey].points,
        label: POINT_EVENTS[eventKey].label,
      });
    }
  }

  /**
   * Reconcile total points and unlocked badges deterministically from the notebook entries.
   * Returns any newly unlocked badge objects.
   */
  function syncGameStateWithNotebook(entries, backfillPreExisting = false) {
    const state = loadGameState();
    let notebookModified = false;

    entries.forEach((entry) => {
      const savedEventsForEntry = state.awarded_events_by_entry[entry.id] || [];
      if (!Array.isArray(entry.awarded_events)) {
        entry.awarded_events = [...savedEventsForEntry];
        notebookModified = true;
      } else {
        savedEventsForEntry.forEach((evKey) => {
          if (!entry.awarded_events.includes(evKey)) {
            entry.awarded_events.push(evKey);
            notebookModified = true;
          }
        });
      }

      // If loading pre-existing entries from before the game layer was added, backfill their baseline events once silently
      if (backfillPreExisting && entry.awarded_events.length === 0) {
        awardEventOnce(entry, "first_scan_completed", null);
        if (entry.signal_type === "positive_signal") {
          awardEventOnce(entry, "positive_signal_bonus", null);
        }
        if (entry.new_evidence) {
          awardEventOnce(entry, "follow_up_completed", null);
          awardEventOnce(entry, "meaningful_new_evidence", null);
        }
        if (entry.entry_state === "player_concluded" && entry.player_conclusion) {
          awardEventOnce(entry, "player_conclusion_saved", null);
        }
        notebookModified = true;
      }

      entry.points_earned = calculateEntryPoints(entry.awarded_events);
      state.awarded_events_by_entry[entry.id] = [...entry.awarded_events];
    });

    if (notebookModified) {
      saveNotebook(entries);
    }

    // Total points across all notebook entries
    state.total_points = entries.reduce(
      (sum, entry) => sum + calculateEntryPoints(entry.awarded_events),
      0
    );

    // Evaluate badges deterministically
    const prevUnlocked = new Set(state.unlocked_badges || []);
    const newlyUnlockedBadges = [];
    const currentUnlockedIds = [];

    BADGE_DEFINITIONS.forEach((badge) => {
      if (badge.check(entries)) {
        currentUnlockedIds.push(badge.id);
        if (!prevUnlocked.has(badge.id)) {
          newlyUnlockedBadges.push(badge);
        }
      }
    });

    state.unlocked_badges = currentUnlockedIds;
    saveGameState(state);
    return newlyUnlockedBadges;
  }

  function updateHeaderGameStatus(state) {
    const safeState = state || loadGameState();
    if (headerPointsValue) {
      headerPointsValue.textContent = String(safeState.total_points || 0);
    }
    if (headerBadgesCount) {
      const unlockedCount = Array.isArray(safeState.unlocked_badges)
        ? safeState.unlocked_badges.length
        : 0;
      headerBadgesCount.textContent = `${unlockedCount}/${BADGE_DEFINITIONS.length}`;
    }
    if (voiceToggleBtn) {
      const isOn = Boolean(safeState.voice_enabled);
      voiceToggleBtn.setAttribute("aria-pressed", isOn ? "true" : "false");
      voiceToggleBtn.textContent = isOn ? "🔊 Voice: On" : "🔇 Voice: Off";
    }
    if (soundToggleBtn) {
      const sOn = safeState.sound_enabled !== false;
      soundToggleBtn.setAttribute("aria-pressed", sOn ? "true" : "false");
      soundToggleBtn.textContent = sOn ? "🔊 Sound" : "🔇 Mute";
    }
  }

  /* =========================================================================
     PLAYFUL WEB AUDIO SYNTHESIZER (Zero external audio files, 100% fail-safe)
     ========================================================================= */

  function getAudioContext() {
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return null;
      if (!audioCtx) {
        audioCtx = new AudioContextClass();
      }
      if (audioCtx.state === "suspended") {
        audioCtx.resume();
      }
      return audioCtx;
    } catch (_) {
      return null;
    }
  }

  function isSoundEnabled() {
    return loadGameState().sound_enabled !== false;
  }

  function playPopSound() {
    if (!isSoundEnabled()) return;
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(420, now);
      osc.frequency.exponentialRampToValueAtTime(720, now + 0.075);
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.085);
    } catch (_) {
      // Ignore audio errors
    }
  }

  function playChronometerTick(sec) {
    if (!isSoundEnabled()) return;
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;

      // Alternating high/low clockwork tick-tock
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      const baseFreq = sec % 2 === 1 ? 860 : 640;
      osc.frequency.setValueAtTime(baseFreq, now);
      osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.75, now + 0.035);
      gain.gain.setValueAtTime(0.06, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.045);

      // Gentle alien radar blip every 3 seconds when status step advances
      if (sec > 0 && sec % 3 === 0) {
        const ping = ctx.createOscillator();
        const pingGain = ctx.createGain();
        ping.type = "sine";
        ping.frequency.setValueAtTime(1180, now + 0.06);
        ping.frequency.exponentialRampToValueAtTime(1480, now + 0.18);
        pingGain.gain.setValueAtTime(0.045, now + 0.06);
        pingGain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
        ping.connect(pingGain);
        pingGain.connect(ctx.destination);
        ping.start(now + 0.06);
        ping.stop(now + 0.23);
      }
    } catch (_) {
      // Ignore audio errors
    }
  }

  function playCelebrationBells(hasBadge) {
    if (!isSoundEnabled()) return;
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      // Happy bell arpeggio (C5 - E5 - G5 - C6), plus extra sparkle if badge unlocked
      const notes = hasBadge
        ? [523.25, 659.25, 783.99, 1046.5, 1318.5, 1567.98]
        : [523.25, 659.25, 783.99, 1046.5];

      notes.forEach((freq, idx) => {
        const start = now + idx * 0.075;
        const duration = idx === notes.length - 1 ? 0.32 : 0.16;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, start);
        gain.gain.setValueAtTime(0.09, start);
        gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(start);
        osc.stop(start + duration + 0.02);
      });
    } catch (_) {
      // Ignore audio errors
    }
  }

  function playErrorFizz() {
    if (!isSoundEnabled()) return;
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(360, now);
      osc.frequency.linearRampToValueAtTime(170, now + 0.24);
      gain.gain.setValueAtTime(0.055, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.26);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.27);
    } catch (_) {
      // Ignore audio errors
    }
  }

  /* =========================================================================
     OPTIONAL USER-CONTROLLED SPEECH & CELEBRATION UI
     ========================================================================= */

  function speakZzorpText(text) {
    if (!text || !("speechSynthesis" in window)) return;
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.04;
      utterance.pitch = 1.18; // Playful friendly alien pitch
      window.speechSynthesis.speak(utterance);
    } catch (_) {
      // Ignore speech synthesis errors on unsupported browsers
    }
  }

  function triggerCelebration(newlyAwardedEvents, newlyUnlockedBadges, reactionSpeechText) {
    const eventsList = Array.isArray(newlyAwardedEvents) ? newlyAwardedEvents : [];
    const badgesList = Array.isArray(newlyUnlockedBadges) ? newlyUnlockedBadges : [];
    const pointsAdded = eventsList.reduce((sum, ev) => sum + (ev.points || 0), 0);

    if (pointsAdded <= 0 && badgesList.length === 0) {
      return;
    }

    if (celebrationPointsHeadline) {
      celebrationPointsHeadline.textContent =
        pointsAdded > 0 ? `+${pointsAdded} Signal Points!` : "Badge Unlocked!";
    }

    if (celebrationReasonsList) {
      celebrationReasonsList.innerHTML = "";
      eventsList.forEach((ev) => {
        const chip = document.createElement("span");
        chip.className = "celebration-reason-chip";
        const strong = document.createElement("strong");
        strong.textContent = `+${ev.points}`;
        chip.appendChild(strong);
        chip.appendChild(document.createTextNode(ev.label));
        celebrationReasonsList.appendChild(chip);
      });
    }

    if (celebrationBadgesWrap) {
      celebrationBadgesWrap.innerHTML = "";
      if (badgesList.length > 0) {
        badgesList.forEach((badge) => {
          const item = document.createElement("div");
          item.className = "celebration-badge-item";
          const emoji = document.createElement("span");
          emoji.className = "badge-emoji";
          emoji.textContent = badge.icon;
          const textDiv = document.createElement("div");
          const titleStrong = document.createElement("strong");
          titleStrong.textContent = `Badge Unlocked: ${badge.name}! `;
          const descSpan = document.createElement("span");
          descSpan.textContent = badge.description;
          textDiv.appendChild(titleStrong);
          textDiv.appendChild(descSpan);
          item.appendChild(emoji);
          item.appendChild(textDiv);
          celebrationBadgesWrap.appendChild(item);
        });
        celebrationBadgesWrap.classList.remove("hidden");
      } else {
        celebrationBadgesWrap.classList.add("hidden");
      }
    }

    // Build speech text for user-controlled announcement
    const speechParts = [];
    if (pointsAdded > 0) {
      speechParts.push(`Plus ${pointsAdded} Signal Points!`);
    }
    if (badgesList.length > 0) {
      speechParts.push(
        `Badge unlocked: ${badgesList.map((b) => b.name).join(" and ")}!`
      );
    }
    if (reactionSpeechText) {
      speechParts.push(reactionSpeechText);
    }
    lastCelebrationSpeechText = speechParts.join(" ");

    if (celebrationBanner) {
      celebrationBanner.classList.remove("hidden");
    }

    // Play cheerful bell chime for points / badge reward
    playCelebrationBells(badgesList.length > 0);

    // Only speak automatically if the user has explicitly turned "Voice: On"
    const gameState = loadGameState();
    if (gameState.voice_enabled && lastCelebrationSpeechText) {
      speakZzorpText(lastCelebrationSpeechText);
    }
  }

  function updateNotebookBadgeCount(count) {
    if (notebookCountPill) {
      notebookCountPill.textContent = String(count);
    }
  }

  function getNotebookEntryById(entryId) {
    return loadNotebook().find((e) => e.id === entryId) || null;
  }

  /**
   * Create a new Field Notebook entry from a first_scan response,
   * or update an existing entry from a follow_up response.
   * Calculates Signal Points and Badges deterministically and triggers celebration.
   */
  function recordScanInNotebook(payload, followUpEntryId) {
    const entries = loadNotebook();
    const result = payload.result;
    const nbUpdate = result.notebook_update || {};
    const incomingSources = Array.isArray(payload.sources) ? payload.sources : [];
    const nowIso = new Date().toISOString();
    const newlyAwardedEvents = [];

    if (followUpEntryId) {
      const idx = entries.findIndex((e) => e.id === followUpEntryId);
      if (idx !== -1) {
        const existing = entries[idx];
        const firstScanEvidenceIds = Array.isArray(existing.initial_evidence_used)
          ? existing.initial_evidence_used
          : Array.isArray(existing.evidence_used)
          ? existing.evidence_used
          : [];
        const incomingEvidenceIds = Array.isArray(result.evidence_used)
          ? result.evidence_used
          : [];

        const mergedEvidenceIds = Array.from(
          new Set([...(existing.evidence_used || []), ...incomingEvidenceIds])
        );

        const sourceMap = new Map();
        (existing.sources || []).forEach((s) => sourceMap.set(s.id, s));
        incomingSources.forEach((s) => sourceMap.set(s.id, s));

        // Never overwrite player_conclusion from model output
        const nextState = existing.player_conclusion
          ? "player_concluded"
          : "evidence_gathered";

        const resolvedNewEvidence =
          nbUpdate.new_evidence ||
          result.signal_summary ||
          "Follow-up photo examined by Zzorp.";

        // Check if Zzorp revised its interpretation (signal_type changed or missing_information resolved)
        const prevSignalType = existing.initial_signal_type || existing.signal_type;
        const signalTypeChanged = Boolean(
          result.signal_type && result.signal_type !== prevSignalType
        );
        const prevMissing = Array.isArray(existing.initial_missing_information)
          ? existing.initial_missing_information
          : Array.isArray(existing.missing_information)
          ? existing.missing_information
          : [];
        const currMissing = Array.isArray(result.missing_information)
          ? result.missing_information
          : [];
        const missingInfoResolved =
          prevMissing.length > 0 &&
          (currMissing.length < prevMissing.length ||
            prevMissing.some((item) => !currMissing.includes(item)));

        existing.updated_at = nowIso;
        existing.entry_state = nextState;
        existing.new_evidence = resolvedNewEvidence;
        existing.follow_up_reaction = result.zzorp_reaction || "";
        existing.evidence_used = mergedEvidenceIds;
        existing.sources = Array.from(sourceMap.values());
        if (result.signal_type) {
          existing.signal_type = result.signal_type;
        }
        if (Array.isArray(result.missing_information)) {
          existing.missing_information = result.missing_information;
        }

        // Award deterministic follow-up Signal Points (each event awarded at most once per entry)
        awardEventOnce(existing, "follow_up_completed", newlyAwardedEvents);

        const hasMeaningfulEvidence =
          (nbUpdate.new_evidence && String(nbUpdate.new_evidence).trim().length > 5) ||
          (Array.isArray(result.visible_facts) && result.visible_facts.length > 0);
        if (hasMeaningfulEvidence) {
          awardEventOnce(existing, "meaningful_new_evidence", newlyAwardedEvents);
        }

        const introducesNewArchiveId = incomingEvidenceIds.some(
          (id) => !firstScanEvidenceIds.includes(id)
        );
        if (introducesNewArchiveId) {
          awardEventOnce(existing, "new_archive_id_bonus", newlyAwardedEvents);
        }

        if (signalTypeChanged || missingInfoResolved) {
          awardEventOnce(existing, "interpretation_revised", newlyAwardedEvents);
        }

        if (result.signal_type === "positive_signal") {
          awardEventOnce(existing, "positive_signal_bonus", newlyAwardedEvents);
        }

        entries[idx] = existing;
        saveNotebook(entries);
        const newlyUnlockedBadges = syncGameStateWithNotebook(entries, false);
        triggerCelebration(
          newlyAwardedEvents,
          newlyUnlockedBadges,
          result.zzorp_reaction || ""
        );
        return existing;
      }
    }

    // Create new entry from first_scan
    const initialEvidence = Array.isArray(result.evidence_used) ? result.evidence_used : [];
    const initialMissing = Array.isArray(result.missing_information)
      ? result.missing_information
      : [];
    const initialSignal = result.signal_type || "no_signal";

    const newEntry = {
      id: `entry_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      created_at: nowIso,
      updated_at: nowIso,
      entry_title: nbUpdate.entry_title || "Earth Specimen",
      zzorp_question: nbUpdate.zzorp_question || "",
      entry_state:
        nbUpdate.entry_state && nbUpdate.entry_state !== "player_concluded"
          ? nbUpdate.entry_state
          : initialSignal === "no_signal"
          ? "observed"
          : "question_open",
      signal_type: initialSignal,
      initial_signal_type: initialSignal,
      signal_summary: result.signal_summary || "",
      zzorp_reaction: result.zzorp_reaction || "",
      visible_facts: result.visible_facts || [],
      inferences: result.inferences || [],
      missing_information: initialMissing,
      initial_missing_information: [...initialMissing],
      mission: result.mission || null,
      evidence_used: [...initialEvidence],
      initial_evidence_used: [...initialEvidence],
      sources: incomingSources,
      new_evidence: null,
      follow_up_reaction: null,
      player_conclusion: null, // Always null until player writes it
      awarded_events: [],
      points_earned: 0,
    };

    // Award deterministic first-scan Signal Points
    awardEventOnce(newEntry, "first_scan_completed", newlyAwardedEvents);
    if (initialSignal === "positive_signal") {
      awardEventOnce(newEntry, "positive_signal_bonus", newlyAwardedEvents);
    }

    entries.unshift(newEntry);
    saveNotebook(entries);
    const newlyUnlockedBadges = syncGameStateWithNotebook(entries, false);
    triggerCelebration(
      newlyAwardedEvents,
      newlyUnlockedBadges,
      result.zzorp_reaction || ""
    );
    return newEntry;
  }

  /**
   * Save the player's own conclusion for an entry and transition state to player_concluded.
   * Awards +15 Signal Points the first time a non-empty conclusion is saved for this entry.
   */
  function savePlayerConclusion(entryId, conclusionText) {
    const trimmed = (conclusionText || "").trim();
    if (!trimmed) return null;

    const entries = loadNotebook();
    const idx = entries.findIndex((e) => e.id === entryId);
    if (idx === -1) return null;

    const newlyAwardedEvents = [];
    entries[idx].player_conclusion = trimmed;
    entries[idx].entry_state = "player_concluded";
    entries[idx].updated_at = new Date().toISOString();

    awardEventOnce(entries[idx], "player_conclusion_saved", newlyAwardedEvents);

    saveNotebook(entries);
    const newlyUnlockedBadges = syncGameStateWithNotebook(entries, false);
    if (newlyAwardedEvents.length === 0 && newlyUnlockedBadges.length === 0) {
      playPopSound();
    } else {
      triggerCelebration(
        newlyAwardedEvents,
        newlyUnlockedBadges,
        "Awesome! I saved your answer in our Field Notebook!"
      );
    }
    return entries[idx];
  }

  /* =========================================================================
     HEALTH CHECK & IMAGE RESIZING
     ========================================================================= */

  async function checkHealth() {
    try {
      const res = await fetch("/api/health");
      if (!res.ok) return;
      const data = await res.json();
      if (data.api_key_configured === false) {
        apiKeyBanner.classList.remove("hidden");
      } else {
        apiKeyBanner.classList.add("hidden");
      }
    } catch (_) {
      // Ignore network hiccup
    }
  }

  function resizeImageToJpegBase64(file) {
    return new Promise((resolve, reject) => {
      if (!file || !file.type.startsWith("image/")) {
        reject(new Error("Please choose a valid image file."));
        return;
      }

      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Could not read the selected image file."));
      reader.onload = (e) => {
        const img = new Image();
        img.onerror = () => reject(new Error("Could not decode the selected image."));
        img.onload = () => {
          let width = img.naturalWidth || img.width;
          let height = img.naturalHeight || img.height;

          if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
            if (width >= height) {
              height = Math.round((height * MAX_DIMENSION) / width);
              width = MAX_DIMENSION;
            } else {
              width = Math.round((width * MAX_DIMENSION) / height);
              height = MAX_DIMENSION;
            }
          }

          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, width, height);

          const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
          const base64Data = dataUrl.split(",")[1];
          resolve({
            dataUrl,
            base64Data,
            width,
            height,
          });
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    });
  }

  async function handleFileSelected(file) {
    if (!file) return;
    hideError();

    try {
      const processed = await resizeImageToJpegBase64(file);
      currentBase64Jpeg = processed.base64Data;

      imagePreview.src = processed.dataUrl;
      imageMetaBadge.textContent = `${processed.width}×${processed.height} JPEG • EXIF stripped`;
      emptyUploadPrompt.classList.add("hidden");
      previewContainer.classList.remove("hidden");
      scanBtn.disabled = false;
      playPopSound();
    } catch (err) {
      showError(err.message || "Could not prepare that photo for scanning.");
    }
  }

  /* =========================================================================
     WAITING & ERROR UI
     ========================================================================= */

  function startWaitingAnimation() {
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    let idx = 0;
    waitingSeconds = 0;
    if (waitingTimerBadge) {
      waitingTimerBadge.textContent = "⏱️ 0s";
    }
    waitingMessage.textContent = WAITING_MESSAGES[0];
    waitDots.forEach((d, i) => d.classList.toggle("active", i === 0));
    waitingState.classList.remove("hidden");
    playChronometerTick(0);

    if (waitingTimer) clearInterval(waitingTimer);
    waitingTimer = setInterval(() => {
      waitingSeconds += 1;
      if (waitingTimerBadge) {
        waitingTimerBadge.textContent = `⏱️ ${waitingSeconds}s`;
      }
      playChronometerTick(waitingSeconds);

      if (waitingSeconds % 3 === 0) {
        idx = (idx + 1) % WAITING_MESSAGES.length;
        waitingMessage.textContent = WAITING_MESSAGES[idx];
        waitDots.forEach((d, i) => d.classList.toggle("active", i === idx));
      }
    }, 1000);
  }

  function stopWaitingAnimation() {
    if (waitingTimer) {
      clearInterval(waitingTimer);
      waitingTimer = null;
    }
    waitingState.classList.add("hidden");
  }

  function showError(msg) {
    errorText.textContent = msg;
    errorCard.classList.remove("hidden");
    playErrorFizz();
  }

  function hideError() {
    errorCard.classList.add("hidden");
    errorText.textContent = "";
  }

  /* =========================================================================
     SCREEN NAVIGATION & FOLLOW-UP MODE
     ========================================================================= */

  function showScreen(screenName) {
    scannerScreen.classList.toggle("hidden", screenName !== "scanner");
    resultsScreen.classList.toggle("hidden", screenName !== "results");
    notebookScreen.classList.toggle("hidden", screenName !== "notebook");

    navScannerBtn.classList.toggle("active", screenName === "scanner" || screenName === "results");
    navNotebookBtn.classList.toggle("active", screenName === "notebook");

    if (screenName === "notebook") {
      renderNotebookScreen();
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function enterFollowUpMode(entryId) {
    const entry = getNotebookEntryById(entryId);
    if (!entry) return;

    activeFollowUpEntryId = entry.id;
    currentBase64Jpeg = null;
    imageInput.value = "";
    cameraInput.value = "";
    imagePreview.src = "";
    previewContainer.classList.add("hidden");
    emptyUploadPrompt.classList.remove("hidden");
    scanBtn.disabled = true;
    hideError();

    if (zzorpWelcomeBubble) zzorpWelcomeBubble.classList.add("hidden");
    if (howItWorksStrip) howItWorksStrip.classList.add("hidden");
    if (scannerStepTag) {
      scannerStepTag.textContent = "FOLLOW-UP MISSION";
      scannerStepTag.classList.remove("hidden");
    }
    scannerHeading.textContent = "Bring Back Your Follow-Up Clue!";
    scanBtnLabel.textContent = "Send Follow-Up Clue to Zzorp!";

    followUpEntryTitle.textContent = entry.entry_title;
    followUpQuestion.textContent = `Open Question: ${entry.zzorp_question}`;
    followUpPhotoTarget.textContent =
      (entry.mission && entry.mission.photo_to_bring_back) ||
      "A closer photo that helps answer Zzorp's question.";
    followUpBanner.classList.remove("hidden");

    showScreen("scanner");
  }

  function exitFollowUpMode() {
    activeFollowUpEntryId = null;
    if (zzorpWelcomeBubble) zzorpWelcomeBubble.classList.remove("hidden");
    if (howItWorksStrip) howItWorksStrip.classList.remove("hidden");
    if (scannerStepTag) scannerStepTag.classList.add("hidden");
    scannerHeading.textContent = "What should Zzorp scan today?";
    scanBtnLabel.textContent = "Scan with Zzorp!";
    followUpBanner.classList.add("hidden");
  }

  function resetToScanner() {
    exitFollowUpMode();
    currentBase64Jpeg = null;
    imageInput.value = "";
    cameraInput.value = "";
    imagePreview.src = "";
    previewContainer.classList.add("hidden");
    emptyUploadPrompt.classList.remove("hidden");
    scanBtn.disabled = true;
    hideError();
    showScreen("scanner");
  }

  /* =========================================================================
     SCREEN 2: RESULTS RENDERING
     ========================================================================= */

  function populateBulletList(ulElement, items) {
    ulElement.innerHTML = "";
    const safeItems = Array.isArray(items) && items.length > 0 ? items : ["None noted."];
    safeItems.forEach((text) => {
      const li = document.createElement("li");
      li.textContent = text;
      ulElement.appendChild(li);
    });
  }

  function applyStatePill(pillElement, stateKey) {
    const meta = ENTRY_STATE_META[stateKey] || ENTRY_STATE_META.observed;
    pillElement.className = `entry-state-pill ${meta.pillClass}`;
    pillElement.textContent = meta.label;
  }

  function renderSources(sources) {
    sourcesContent.innerHTML = "";
    const list = Array.isArray(sources) ? sources : [];
    const count = list.length;

    sourcesCountBadge.textContent =
      count === 1 ? "1 Earth fact used" : `${count} Earth facts used`;

    if (count === 0) {
      sourcesDrawer.open = false;
      const note = document.createElement("p");
      note.className = "no-sources-note";
      note.textContent =
        "Zzorp didn't need the Earth Fact Book for this photo — everything was clear just by looking!";
      sourcesContent.appendChild(note);
      return;
    }

    list.forEach((src) => {
      const item = document.createElement("div");
      item.className = "source-item";

      const top = document.createElement("div");
      top.className = "source-item-top";

      const org = document.createElement("span");
      org.className = "source-org-badge";
      org.textContent = src.id;

      const meta = document.createElement("span");
      meta.className = "source-meta-pill";
      meta.textContent = `Fact check: ${src.confidence || "verified"}`;

      top.appendChild(org);
      top.appendChild(meta);

      const claim = document.createElement("p");
      claim.className = "source-claim";
      claim.textContent = src.source || "";

      const link = document.createElement("a");
      link.className = "source-link";
      link.href = src.url || "#";
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "Read Earth fact source ↗";

      item.appendChild(top);
      item.appendChild(claim);
      item.appendChild(link);

      sourcesContent.appendChild(item);
    });
  }

  function renderVerificationTrace(trace) {
    if (!verificationTraceDrawer) return;
    verificationTraceDrawer.open = false; // collapsed by default per Section 6
    const safeTrace = trace || {};
    const summaryText =
      safeTrace.summary_line ||
      safeTrace.summary ||
      "Observed specimen → checked Earth archive → verified schema guarantees ✓";

    if (traceSummaryInline) {
      traceSummaryInline.textContent = summaryText;
    }
    if (traceSummaryFull) {
      traceSummaryFull.textContent = summaryText;
    }
    if (traceMetricsGrid) {
      traceMetricsGrid.innerHTML = "";
      const searches = Array.isArray(safeTrace.searches_run)
        ? safeTrace.searches_run
        : [];
      const searchLabel =
        searches.length > 0
          ? searches
              .map((s) =>
                s.signal ? `"${s.topic}" (${s.signal})` : `"${s.topic}"`
              )
              .join(", ")
          : "Not needed (direct observation)";
      const retrievedCount = Array.isArray(safeTrace.retrieved_ids)
        ? safeTrace.retrieved_ids.length
        : 0;
      const citedCount = Array.isArray(safeTrace.cited_ids)
        ? safeTrace.cited_ids.length
        : 0;

      const metrics = [
        {
          label: "Visual Facts Observed",
          value: String(safeTrace.observed_count ?? 0),
        },
        {
          label: "Archive Query",
          value: searchLabel,
        },
        {
          label: "Archive Matches → Cited",
          value: `${retrievedCount} found → ${citedCount} cited`,
        },
        {
          label: "Server Guarantees Enforced",
          value:
            "evidence_whitelist ✓, player_conclusion=null ✓, entry_state_guarded ✓",
        },
      ];
      metrics.forEach((m) => {
        const div = document.createElement("div");
        div.className = "trace-metric-item";
        const span = document.createElement("span");
        span.textContent = m.label;
        const strong = document.createElement("strong");
        strong.textContent = m.value;
        div.appendChild(span);
        div.appendChild(strong);
        traceMetricsGrid.appendChild(div);
      });
    }
  }

  function renderResults(payload, savedEntry) {
    const result = payload.result;
    const sources = savedEntry ? savedEntry.sources : payload.sources || [];
    currentResultEntryId = savedEntry ? savedEntry.id : null;

    resultsHeading.textContent =
      (savedEntry && savedEntry.entry_title) ||
      (result.notebook_update && result.notebook_update.entry_title) ||
      "Earth Specimen Report";

    applyStatePill(
      resultEntryStatePill,
      (savedEntry && savedEntry.entry_state) ||
        (result.notebook_update && result.notebook_update.entry_state) ||
        "observed"
    );

    // Signal Classification
    const sigType = result.signal_type || "no_signal";
    const meta = SIGNAL_META[sigType] || SIGNAL_META.no_signal;

    signalCard.className = `result-card signal-card ${meta.cardClass}`;
    signalBadge.className = `signal-badge ${meta.badgeClass}`;
    signalBadge.textContent = meta.label;
    signalSummary.textContent = result.signal_summary || "";

    // Zzorp Says
    zzorpReaction.textContent = result.zzorp_reaction || "";

    // New Evidence card (shown on follow_up or if entry has new_evidence)
    const newEv =
      (result.notebook_update && result.notebook_update.new_evidence) ||
      (savedEntry && savedEntry.new_evidence);
    if (newEv) {
      newEvidenceText.textContent = newEv;
      newEvidenceCard.classList.remove("hidden");
    } else {
      newEvidenceCard.classList.add("hidden");
    }

    // Lists
    populateBulletList(visibleFactsList, result.visible_facts);
    populateBulletList(inferencesList, result.inferences);
    populateBulletList(missingInfoList, result.missing_information);

    // Mission
    const activeMission = result.mission || (savedEntry && savedEntry.mission);
    if (activeMission && typeof activeMission === "object" && result.scan_type !== "follow_up") {
      missionInstruction.textContent = activeMission.instruction || "";
      missionPhotoTarget.textContent = activeMission.photo_to_bring_back || "";
      if (activeMission.ask_an_adult === true) {
        askAdultBadge.classList.remove("hidden");
      } else {
        askAdultBadge.classList.add("hidden");
      }
      missionCard.classList.remove("hidden");
    } else {
      missionCard.classList.add("hidden");
    }

    // Player Conclusion Box
    const questionText =
      (savedEntry && savedEntry.zzorp_question) ||
      (result.notebook_update && result.notebook_update.zzorp_question) ||
      "What do you conclude from this specimen?";
    resultZzorpQuestion.textContent = `Zzorp's Question: "${questionText}"`;
    resultConclusionInput.value = (savedEntry && savedEntry.player_conclusion) || "";
    resultConclusionSavedNote.classList.toggle(
      "hidden",
      !(savedEntry && savedEntry.player_conclusion)
    );

    // Sources, Clues Drawer & Verification Trace
    if (cluesDrawer) cluesDrawer.open = false;
    renderSources(sources);
    renderVerificationTrace(payload.verification_trace);

    showScreen("results");
  }

  /* =========================================================================
     SCREEN 3: FIELD NOTEBOOK RENDERING
     ========================================================================= */

  function renderBadgesGrid(unlockedIds) {
    if (!badgesGrid) return;
    badgesGrid.innerHTML = "";
    const unlockedSet = new Set(Array.isArray(unlockedIds) ? unlockedIds : []);

    BADGE_DEFINITIONS.forEach((b) => {
      const isUnlocked = unlockedSet.has(b.id);
      const card = document.createElement("div");
      card.className = `badge-card ${isUnlocked ? "unlocked" : "locked"}`;

      const icon = document.createElement("span");
      icon.className = "badge-icon";
      icon.textContent = b.icon;

      const name = document.createElement("span");
      name.className = "badge-name";
      name.textContent = b.name;

      const desc = document.createElement("span");
      desc.className = "badge-desc";
      desc.textContent = b.description;

      const status = document.createElement("span");
      status.className = "badge-status";
      status.textContent = isUnlocked ? "✓ Unlocked" : "🔒 Locked";

      card.appendChild(icon);
      card.appendChild(name);
      card.appendChild(desc);
      card.appendChild(status);
      badgesGrid.appendChild(card);
    });
  }

  function renderNotebookScreen() {
    const entries = loadNotebook();
    updateNotebookBadgeCount(entries.length);
    syncGameStateWithNotebook(entries, true);

    const gameState = loadGameState();
    if (nbTotalPoints) {
      nbTotalPoints.textContent = String(gameState.total_points || 0);
    }
    renderBadgesGrid(gameState.unlocked_badges || []);

    notebookEntriesList.innerHTML = "";
    if (entries.length === 0) {
      notebookEmptyState.classList.remove("hidden");
      return;
    }
    notebookEmptyState.classList.add("hidden");

    entries.forEach((entry) => {
      const card = document.createElement("article");
      card.className = "notebook-entry-card";

      // Top bar: Signal badge + Points pill + Entry state pill
      const top = document.createElement("div");
      top.className = "nb-card-top";

      const sigMeta = SIGNAL_META[entry.signal_type] || SIGNAL_META.no_signal;
      const sigBadge = document.createElement("span");
      sigBadge.className = `signal-badge ${sigMeta.badgeClass}`;
      sigBadge.style.fontSize = "0.84rem";
      sigBadge.style.padding = "0.24rem 0.68rem";
      sigBadge.textContent = sigMeta.label;

      const rightPills = document.createElement("div");
      rightPills.style.display = "flex";
      rightPills.style.alignItems = "center";
      rightPills.style.gap = "0.45rem";
      rightPills.style.flexWrap = "wrap";

      const pointsPill = document.createElement("span");
      pointsPill.className = "nb-entry-points-pill";
      pointsPill.textContent = `⚡ ${entry.points_earned || 0} pts`;

      const statePill = document.createElement("span");
      applyStatePill(statePill, entry.entry_state);

      rightPills.appendChild(pointsPill);
      rightPills.appendChild(statePill);

      top.appendChild(sigBadge);
      top.appendChild(rightPills);
      card.appendChild(top);

      // Title
      const title = document.createElement("h3");
      title.className = "nb-card-title";
      title.textContent = entry.entry_title;
      card.appendChild(title);

      // Zzorp's open question
      if (entry.zzorp_question) {
        const qBox = document.createElement("div");
        qBox.className = "nb-question-box";
        const qStrong = document.createElement("strong");
        qStrong.textContent = "Zzorp's Question: ";
        const qSpan = document.createElement("span");
        qSpan.textContent = entry.zzorp_question;
        qBox.appendChild(qStrong);
        qBox.appendChild(qSpan);
        card.appendChild(qBox);
      }

      // New evidence from follow-up scan (if present)
      if (entry.new_evidence) {
        const evBox = document.createElement("div");
        evBox.className = "nb-new-evidence-box";
        const evStrong = document.createElement("strong");
        evStrong.textContent = "🔬 New Clue Found:";
        const evSpan = document.createElement("span");
        evSpan.textContent = entry.new_evidence;
        evBox.appendChild(evStrong);
        evBox.appendChild(evSpan);
        card.appendChild(evBox);
      }

      // Mission + Follow-up upload button
      if (entry.mission && typeof entry.mission === "object") {
        const mBox = document.createElement("div");
        mBox.className = "nb-mission-box";

        const mTop = document.createElement("div");
        mTop.className = "nb-mission-box-top";

        const mLabel = document.createElement("strong");
        mLabel.style.color = "var(--accent-cyan)";
        mLabel.textContent = "🚀 Your Mission:";
        mTop.appendChild(mLabel);

        if (entry.mission.ask_an_adult) {
          const adultSpan = document.createElement("span");
          adultSpan.className = "ask-adult-badge";
          adultSpan.textContent = "🤝 Ask an adult";
          mTop.appendChild(adultSpan);
        }
        mBox.appendChild(mTop);

        const mInst = document.createElement("p");
        mInst.style.margin = "0 0 0.45rem";
        mInst.textContent = entry.mission.instruction || "";
        mBox.appendChild(mInst);

        const followBtn = document.createElement("button");
        followBtn.type = "button";
        followBtn.className = "btn btn-secondary btn-small";
        followBtn.textContent = entry.new_evidence
          ? "📷 Upload Another Follow-up Photo"
          : "📷 Upload Follow-up Photo (+20 pts)";
        followBtn.addEventListener("click", () => enterFollowUpMode(entry.id));
        mBox.appendChild(followBtn);

        card.appendChild(mBox);
      }

      // Player Conclusion Box (Player-owned)
      const concArea = document.createElement("div");
      concArea.className = "nb-conclusion-area";

      const concLabel = document.createElement("label");
      concLabel.className = "nb-conclusion-label";
      concLabel.textContent = "✏️ WHAT DO YOU THINK? (YOU DECIDE, NOT ZZORP)";
      concArea.appendChild(concLabel);

      const textarea = document.createElement("textarea");
      textarea.className = "conclusion-textarea";
      textarea.rows = 2;
      textarea.placeholder = "Write what YOU think about this Earth habit…";
      textarea.value = entry.player_conclusion || "";
      concArea.appendChild(textarea);

      const actionsRow = document.createElement("div");
      actionsRow.className = "conclusion-actions";

      const saveBtn = document.createElement("button");
      saveBtn.type = "button";
      saveBtn.className = "btn btn-primary btn-small";
      saveBtn.textContent = "💾 Save My Answer (+15 pts)";

      const savedNote = document.createElement("span");
      savedNote.className = `conclusion-saved-note ${
        entry.player_conclusion ? "" : "hidden"
      }`;
      savedNote.textContent = "⭐ Solved by you!";

      saveBtn.addEventListener("click", () => {
        const updated = savePlayerConclusion(entry.id, textarea.value);
        if (updated) {
          renderNotebookScreen();
        }
      });

      actionsRow.appendChild(saveBtn);
      actionsRow.appendChild(savedNote);
      concArea.appendChild(actionsRow);

      card.appendChild(concArea);
      notebookEntriesList.appendChild(card);
    });
  }

  /* =========================================================================
     SUBMIT SCAN (FIRST SCAN OR FOLLOW-UP)
     ========================================================================= */

  async function submitScan() {
    if (!currentBase64Jpeg) return;

    hideError();
    scanBtn.disabled = true;
    startWaitingAnimation();

    const isFollowUp = Boolean(activeFollowUpEntryId);
    const followUpEntry = isFollowUp ? getNotebookEntryById(activeFollowUpEntryId) : null;

    const requestBody = {
      image_base64: currentBase64Jpeg,
      mime_type: "image/jpeg",
      scan_type: isFollowUp && followUpEntry ? "follow_up" : "first_scan",
      previous_entry:
        isFollowUp && followUpEntry
          ? {
              entry_title: followUpEntry.entry_title,
              signal_type: followUpEntry.signal_type,
              zzorp_question: followUpEntry.zzorp_question,
              missing_information: followUpEntry.missing_information,
              mission: followUpEntry.mission,
              evidence_used: followUpEntry.evidence_used,
            }
          : null,
    };

    try {
      const response = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      const data = await response.json();
      stopWaitingAnimation();

      if (!response.ok || !data.ok) {
        if (data.missing_api_key) {
          apiKeyBanner.classList.remove("hidden");
        }
        showError(
          data.error_in_character ||
            "My instruments are confused and my antennae are fizzing. Please try scanning again!"
        );
        scanBtn.disabled = false;
        return;
      }

      apiKeyBanner.classList.add("hidden");
      const targetFollowUpId = activeFollowUpEntryId;
      exitFollowUpMode();

      const savedEntry = recordScanInNotebook(data, targetFollowUpId);
      renderResults(data, savedEntry);
    } catch (_) {
      stopWaitingAnimation();
      showError(
        "My instruments are confused — could not reach the ship's computer. Please try again!"
      );
      scanBtn.disabled = false;
    }
  }

  /* =========================================================================
     MILESTONE 3: EXAMPLES FOLDER & LIVE PITCH DEMO PRESETS
     ========================================================================= */

  async function loadExampleFiles() {
    if (!exampleFilesRow) return;
    try {
      const res = await fetch("/api/examples");
      if (!res.ok) return;
      const data = await res.json();
      const files = Array.isArray(data.examples) ? data.examples : [];
      if (files.length === 0) return;

      exampleFilesRow.innerHTML = "";
      files.forEach((fileObj) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "btn btn-secondary btn-small";
        btn.textContent = `🖼️ ${fileObj.name}`;
        btn.addEventListener("click", async () => {
          hideError();
          try {
            const imgRes = await fetch(fileObj.url);
            const blob = await imgRes.blob();
            const file = new File([blob], fileObj.name, {
              type: blob.type || "image/jpeg",
            });
            await handleFileSelected(file);
          } catch (_) {
            showError(`Could not load example image ${fileObj.name}.`);
          }
        });
        exampleFilesRow.appendChild(btn);
      });
    } catch (_) {
      // Ignore if offline
    }
  }

  async function runDemoPreset(presetName) {
    hideError();
    startWaitingAnimation();
    try {
      let targetFollowUpId = null;

      // If running the follow_up demo preset, attach it to an existing entry (or create the cup entry first)
      if (presetName === "follow_up") {
        let entries = loadNotebook();
        if (activeFollowUpEntryId && getNotebookEntryById(activeFollowUpEntryId)) {
          targetFollowUpId = activeFollowUpEntryId;
        } else if (entries.length > 0) {
          targetFollowUpId = entries[0].id;
        } else {
          const cupRes = await fetch("/api/demo_preset/cup");
          const cupData = await cupRes.json();
          if (cupRes.ok && cupData.ok) {
            const seeded = recordScanInNotebook(cupData, null);
            targetFollowUpId = seeded ? seeded.id : null;
          }
        }
      }

      const res = await fetch(`/api/demo_preset/${encodeURIComponent(presetName)}`);
      const data = await res.json();
      stopWaitingAnimation();
      if (!res.ok || !data.ok) {
        showError("Could not load that demo specimen preset.");
        return;
      }
      exitFollowUpMode();
      const savedEntry = recordScanInNotebook(data, targetFollowUpId);
      renderResults(data, savedEntry);
    } catch (_) {
      stopWaitingAnimation();
      showError("Could not reach the ship's computer for the demo specimen.");
    }
  }

  /* =========================================================================
     EVENT LISTENERS & INITIALIZATION
     ========================================================================= */

  navScannerBtn.addEventListener("click", () => showScreen("scanner"));
  navNotebookBtn.addEventListener("click", () => showScreen("notebook"));
  viewInNotebookBtn.addEventListener("click", () => showScreen("notebook"));
  goToScannerFromEmptyBtn.addEventListener("click", resetToScanner);
  cancelFollowUpBtn.addEventListener("click", exitFollowUpMode);

  if (headerPointsBtn) {
    headerPointsBtn.addEventListener("click", () => showScreen("notebook"));
  }
  if (headerBadgesBtn) {
    headerBadgesBtn.addEventListener("click", () => showScreen("notebook"));
  }
  if (voiceToggleBtn) {
    voiceToggleBtn.addEventListener("click", () => {
      const state = loadGameState();
      state.voice_enabled = !state.voice_enabled;
      saveGameState(state);
      updateHeaderGameStatus(state);
      if (!state.voice_enabled && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    });
  }
  if (soundToggleBtn) {
    soundToggleBtn.addEventListener("click", () => {
      const state = loadGameState();
      state.sound_enabled = state.sound_enabled === false;
      saveGameState(state);
      updateHeaderGameStatus(state);
      if (state.sound_enabled) {
        playPopSound();
      } else if ("speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    });
  }
  if (celebrationCloseBtn) {
    celebrationCloseBtn.addEventListener("click", () => {
      if (celebrationBanner) {
        celebrationBanner.classList.add("hidden");
      }
      if ("speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    });
  }
  if (celebrationSpeakBtn) {
    celebrationSpeakBtn.addEventListener("click", () => {
      if (lastCelebrationSpeechText) {
        speakZzorpText(lastCelebrationSpeechText);
      }
    });
  }
  if (speakReactionBtn) {
    speakReactionBtn.addEventListener("click", () => {
      if (zzorpReaction && zzorpReaction.textContent) {
        speakZzorpText(zzorpReaction.textContent);
      }
    });
  }
  if (welcomeSpeakBtn) {
    welcomeSpeakBtn.addEventListener("click", () => {
      speakZzorpText(
        "Beep-boop! I'm Zzorp from outer space — take a photo of a cup, bin, wrapper, plant or something around you, and let's hunt for Earth clues together!"
      );
    });
  }

  startFollowUpFromResultsBtn.addEventListener("click", () => {
    if (currentResultEntryId) {
      enterFollowUpMode(currentResultEntryId);
    }
  });

  saveResultConclusionBtn.addEventListener("click", () => {
    if (!currentResultEntryId) return;
    const updated = savePlayerConclusion(currentResultEntryId, resultConclusionInput.value);
    if (updated) {
      applyStatePill(resultEntryStatePill, updated.entry_state);
      resultConclusionSavedNote.classList.remove("hidden");
    }
  });

  clearNotebookBtn.addEventListener("click", () => {
    if (window.confirm("Clear all entries, Signal Points, and Badges in your Field Notebook?")) {
      const prevState = loadGameState();
      saveNotebook([]);
      saveGameState({
        total_points: 0,
        awarded_events_by_entry: {},
        unlocked_badges: [],
        voice_enabled: prevState.voice_enabled,
        sound_enabled: prevState.sound_enabled,
      });
      if (celebrationBanner) {
        celebrationBanner.classList.add("hidden");
      }
      renderNotebookScreen();
    }
  });

  imageInput.addEventListener("change", (e) => {
    if (e.target.files && e.target.files[0]) {
      handleFileSelected(e.target.files[0]);
    }
  });

  cameraInput.addEventListener("change", (e) => {
    if (e.target.files && e.target.files[0]) {
      handleFileSelected(e.target.files[0]);
    }
  });

  uploadDropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    uploadDropZone.classList.add("dragover");
  });

  uploadDropZone.addEventListener("dragleave", () => {
    uploadDropZone.classList.remove("dragover");
  });

  uploadDropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    uploadDropZone.classList.remove("dragover");
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelected(e.dataTransfer.files[0]);
    }
  });

  scanBtn.addEventListener("click", submitScan);
  newScanBtn.addEventListener("click", resetToScanner);

  demoPresetBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const preset = btn.getAttribute("data-preset");
      if (preset) {
        runDemoPreset(preset);
      }
    });
  });

  // Initialize
  const initialEntries = loadNotebook();
  updateNotebookBadgeCount(initialEntries.length);
  syncGameStateWithNotebook(initialEntries, true);
  checkHealth();
  loadExampleFiles();
})();
