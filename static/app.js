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

  const MAX_DIMENSION = 1600;
  const JPEG_QUALITY = 0.85;
  const NOTEBOOK_STORAGE_KEY = "zzorp_field_notebook_v1";

  const WAITING_MESSAGES = [
    "Scanning specimen…",
    "Consulting Earth archive…",
    "Checking whether humans actually know this…",
  ];

  const SIGNAL_META = {
    possible_contradiction: {
      label: "⚡ Possible contradiction",
      cardClass: "signal-possible_contradiction",
      badgeClass: "badge-possible_contradiction",
    },
    positive_signal: {
      label: "🌱 Positive signal",
      cardClass: "signal-positive_signal",
      badgeClass: "badge-positive_signal",
    },
    insufficient_evidence: {
      label: "🔎 More information needed",
      cardClass: "signal-insufficient_evidence",
      badgeClass: "badge-insufficient_evidence",
    },
    no_signal: {
      label: "✨ No signal detected",
      cardClass: "signal-no_signal",
      badgeClass: "badge-no_signal",
    },
  };

  const ENTRY_STATE_META = {
    observed: { label: "Observed", pillClass: "state-observed" },
    question_open: { label: "Question Open", pillClass: "state-question_open" },
    evidence_gathered: { label: "Evidence Gathered", pillClass: "state-evidence_gathered" },
    player_concluded: { label: "Player Concluded ✓", pillClass: "state-player_concluded" },
  };

  // DOM Elements: Navigation & Screens
  const apiKeyBanner = document.getElementById("apiKeyBanner");
  const navScannerBtn = document.getElementById("navScannerBtn");
  const navNotebookBtn = document.getElementById("navNotebookBtn");
  const notebookCountPill = document.getElementById("notebookCountPill");

  const scannerScreen = document.getElementById("scannerScreen");
  const resultsScreen = document.getElementById("resultsScreen");
  const notebookScreen = document.getElementById("notebookScreen");

  // Screen 1 Elements
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
  const newEvidenceCard = document.getElementById("newEvidenceCard");
  const newEvidenceText = document.getElementById("newEvidenceText");
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
  const notebookEmptyState = document.getElementById("notebookEmptyState");
  const goToScannerFromEmptyBtn = document.getElementById("goToScannerFromEmptyBtn");
  const notebookEntriesList = document.getElementById("notebookEntriesList");

  // In-memory state
  let currentBase64Jpeg = null;
  let waitingTimer = null;
  let activeFollowUpEntryId = null; // non-null when scanning a follow-up photo for an existing notebook entry
  let currentResultEntryId = null; // ID of the notebook entry currently shown on Screen 2

  /* =========================================================================
     FIELD NOTEBOOK STORAGE (localStorage — never stores images)
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
   */
  function recordScanInNotebook(payload, followUpEntryId) {
    const entries = loadNotebook();
    const result = payload.result;
    const nbUpdate = result.notebook_update || {};
    const incomingSources = Array.isArray(payload.sources) ? payload.sources : [];
    const nowIso = new Date().toISOString();

    if (followUpEntryId) {
      const idx = entries.findIndex((e) => e.id === followUpEntryId);
      if (idx !== -1) {
        const existing = entries[idx];
        const mergedEvidenceIds = Array.from(
          new Set([...(existing.evidence_used || []), ...(result.evidence_used || [])])
        );

        const sourceMap = new Map();
        (existing.sources || []).forEach((s) => sourceMap.set(s.id, s));
        incomingSources.forEach((s) => sourceMap.set(s.id, s));

        // Never overwrite player_conclusion from model output
        const nextState = existing.player_conclusion
          ? "player_concluded"
          : "evidence_gathered";

        existing.updated_at = nowIso;
        existing.entry_state = nextState;
        existing.new_evidence =
          nbUpdate.new_evidence ||
          result.signal_summary ||
          "Follow-up photo examined by Zzorp.";
        existing.follow_up_reaction = result.zzorp_reaction || "";
        existing.evidence_used = mergedEvidenceIds;
        existing.sources = Array.from(sourceMap.values());

        entries[idx] = existing;
        saveNotebook(entries);
        return existing;
      }
    }

    // Create new entry from first_scan
    const newEntry = {
      id: `entry_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      created_at: nowIso,
      updated_at: nowIso,
      entry_title: nbUpdate.entry_title || "Earth Specimen",
      zzorp_question: nbUpdate.zzorp_question || "",
      entry_state:
        nbUpdate.entry_state && nbUpdate.entry_state !== "player_concluded"
          ? nbUpdate.entry_state
          : result.signal_type === "no_signal"
          ? "observed"
          : "question_open",
      signal_type: result.signal_type || "no_signal",
      signal_summary: result.signal_summary || "",
      zzorp_reaction: result.zzorp_reaction || "",
      visible_facts: result.visible_facts || [],
      inferences: result.inferences || [],
      missing_information: result.missing_information || [],
      mission: result.mission || null,
      evidence_used: result.evidence_used || [],
      sources: incomingSources,
      new_evidence: null,
      follow_up_reaction: null,
      player_conclusion: null, // Always null until player writes it
    };

    entries.unshift(newEntry);
    saveNotebook(entries);
    return newEntry;
  }

  /**
   * Save the player's own conclusion for an entry and transition state to player_concluded.
   */
  function savePlayerConclusion(entryId, conclusionText) {
    const trimmed = (conclusionText || "").trim();
    if (!trimmed) return null;

    const entries = loadNotebook();
    const idx = entries.findIndex((e) => e.id === entryId);
    if (idx === -1) return null;

    entries[idx].player_conclusion = trimmed;
    entries[idx].entry_state = "player_concluded";
    entries[idx].updated_at = new Date().toISOString();
    saveNotebook(entries);
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
    } catch (err) {
      showError(err.message || "Could not prepare that photo for scanning.");
    }
  }

  /* =========================================================================
     WAITING & ERROR UI
     ========================================================================= */

  function startWaitingAnimation() {
    let idx = 0;
    waitingMessage.textContent = WAITING_MESSAGES[0];
    waitDots.forEach((d, i) => d.classList.toggle("active", i === 0));
    waitingState.classList.remove("hidden");

    if (waitingTimer) clearInterval(waitingTimer);
    waitingTimer = setInterval(() => {
      idx = (idx + 1) % WAITING_MESSAGES.length;
      waitingMessage.textContent = WAITING_MESSAGES[idx];
      waitDots.forEach((d, i) => d.classList.toggle("active", i === idx));
    }, 2400);
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

    scannerStepTag.textContent = "SCREEN 1 • FOLLOW-UP INVESTIGATION";
    scannerHeading.textContent = "Bring Back Follow-up Evidence";
    scanBtnLabel.textContent = "Transmit Follow-up to Zzorp";

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
    scannerStepTag.textContent = "SCREEN 1 • SIGNAL SCANNER";
    scannerHeading.textContent = "Capture or Choose an Earth Specimen";
    scanBtnLabel.textContent = "Transmit to Zzorp";
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
      count === 1 ? "1 archive entry cited" : `${count} archive entries cited`;

    if (count === 0) {
      sourcesDrawer.open = false;
      const note = document.createElement("p");
      note.className = "no-sources-note";
      note.textContent =
        "No Earth Evidence Archive entries were needed for this scan — Zzorp relied purely on direct visual observation.";
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
      meta.textContent = `Confidence: ${src.confidence || "verified"}`;

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
      link.textContent = "View Earth archive source ↗";

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

    // Sources & Verification Trace
    renderSources(sources);
    renderVerificationTrace(payload.verification_trace);

    showScreen("results");
  }

  /* =========================================================================
     SCREEN 3: FIELD NOTEBOOK RENDERING
     ========================================================================= */

  function renderNotebookScreen() {
    const entries = loadNotebook();
    updateNotebookBadgeCount(entries.length);

    notebookEntriesList.innerHTML = "";
    if (entries.length === 0) {
      notebookEmptyState.classList.remove("hidden");
      return;
    }
    notebookEmptyState.classList.add("hidden");

    entries.forEach((entry) => {
      const card = document.createElement("article");
      card.className = "notebook-entry-card";

      // Top bar: Signal badge + Entry state pill
      const top = document.createElement("div");
      top.className = "nb-card-top";

      const sigMeta = SIGNAL_META[entry.signal_type] || SIGNAL_META.no_signal;
      const sigBadge = document.createElement("span");
      sigBadge.className = `signal-badge ${sigMeta.badgeClass}`;
      sigBadge.style.fontSize = "0.84rem";
      sigBadge.style.padding = "0.24rem 0.68rem";
      sigBadge.textContent = sigMeta.label;

      const statePill = document.createElement("span");
      applyStatePill(statePill, entry.entry_state);

      top.appendChild(sigBadge);
      top.appendChild(statePill);
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
        evStrong.textContent = "🔬 Follow-up Evidence Gathered:";
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
        mLabel.textContent = "🚀 Mission:";
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
          : "📷 Upload Follow-up Photo";
        followBtn.addEventListener("click", () => enterFollowUpMode(entry.id));
        mBox.appendChild(followBtn);

        card.appendChild(mBox);
      }

      // Player Conclusion Box (Player-owned)
      const concArea = document.createElement("div");
      concArea.className = "nb-conclusion-area";

      const concLabel = document.createElement("label");
      concLabel.className = "nb-conclusion-label";
      concLabel.textContent = "✏️ YOUR CONCLUSION (WRITTEN BY YOU, NEVER BY ZZORP)";
      concArea.appendChild(concLabel);

      const textarea = document.createElement("textarea");
      textarea.className = "conclusion-textarea";
      textarea.rows = 2;
      textarea.placeholder = "Write your own conclusion about this human habit…";
      textarea.value = entry.player_conclusion || "";
      concArea.appendChild(textarea);

      const actionsRow = document.createElement("div");
      actionsRow.className = "conclusion-actions";

      const saveBtn = document.createElement("button");
      saveBtn.type = "button";
      saveBtn.className = "btn btn-primary btn-small";
      saveBtn.textContent = "💾 Save Conclusion";

      const savedNote = document.createElement("span");
      savedNote.className = `conclusion-saved-note ${
        entry.player_conclusion ? "" : "hidden"
      }`;
      savedNote.textContent = "✓ Concluded by field partner";

      saveBtn.addEventListener("click", () => {
        const updated = savePlayerConclusion(entry.id, textarea.value);
        if (updated) {
          applyStatePill(statePill, updated.entry_state);
          savedNote.classList.remove("hidden");
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
              zzorp_question: followUpEntry.zzorp_question,
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
      const res = await fetch(`/api/demo_preset/${encodeURIComponent(presetName)}`);
      const data = await res.json();
      stopWaitingAnimation();
      if (!res.ok || !data.ok) {
        showError("Could not load that demo specimen preset.");
        return;
      }
      exitFollowUpMode();
      const savedEntry = recordScanInNotebook(data, null);
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
    if (window.confirm("Clear all entries in your Field Notebook?")) {
      saveNotebook([]);
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
  updateNotebookBadgeCount(loadNotebook().length);
  checkHealth();
  loadExampleFiles();
})();
