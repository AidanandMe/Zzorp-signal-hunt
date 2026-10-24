/**
 * Zzorp Signal Hunt — Frontend Controller (Milestone 1: First Honest Scan)
 *
 * - Resizes images in browser via <canvas> to max 1600px JPEG (strips EXIF/GPS metadata).
 * - Never stores uploaded images on disk.
 * - Renders Screen 1 (Signal Scanner) and Screen 2 (Results + Zzorp's Sources).
 */

(function () {
  "use strict";

  const MAX_DIMENSION = 1600;
  const JPEG_QUALITY = 0.85;

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

  // DOM Elements
  const apiKeyBanner = document.getElementById("apiKeyBanner");
  const scannerScreen = document.getElementById("scannerScreen");
  const resultsScreen = document.getElementById("resultsScreen");

  const imageInput = document.getElementById("imageInput");
  const cameraInput = document.getElementById("cameraInput");
  const uploadDropZone = document.getElementById("uploadDropZone");
  const emptyUploadPrompt = document.getElementById("emptyUploadPrompt");
  const previewContainer = document.getElementById("previewContainer");
  const imagePreview = document.getElementById("imagePreview");
  const imageMetaBadge = document.getElementById("imageMetaBadge");

  const scanBtn = document.getElementById("scanBtn");
  const waitingState = document.getElementById("waitingState");
  const waitingMessage = document.getElementById("waitingMessage");
  const waitDots = [
    document.getElementById("waitDot0"),
    document.getElementById("waitDot1"),
    document.getElementById("waitDot2"),
  ];

  const errorCard = document.getElementById("errorCard");
  const errorText = document.getElementById("errorText");

  const newScanBtn = document.getElementById("newScanBtn");
  const resultsHeading = document.getElementById("resultsHeading");
  const signalCard = document.getElementById("signalCard");
  const signalBadge = document.getElementById("signalBadge");
  const signalSummary = document.getElementById("signalSummary");
  const zzorpReaction = document.getElementById("zzorpReaction");
  const visibleFactsList = document.getElementById("visibleFactsList");
  const inferencesList = document.getElementById("inferencesList");
  const missingInfoList = document.getElementById("missingInfoList");

  const missionCard = document.getElementById("missionCard");
  const askAdultBadge = document.getElementById("askAdultBadge");
  const missionInstruction = document.getElementById("missionInstruction");
  const missionPhotoTarget = document.getElementById("missionPhotoTarget");

  const sourcesDrawer = document.getElementById("sourcesDrawer");
  const sourcesCountBadge = document.getElementById("sourcesCountBadge");
  const sourcesContent = document.getElementById("sourcesContent");

  // State in memory only (never persisted for raw images)
  let currentBase64Jpeg = null;
  let waitingTimer = null;

  /**
   * Check server health & whether .env has a configured API key.
   */
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
      // Ignore network hiccup on initial health check
    }
  }

  /**
   * Resize image file in browser via <canvas> to max 1600px JPEG.
   * Strips EXIF/GPS metadata and reduces payload size.
   */
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

  function populateBulletList(ulElement, items) {
    ulElement.innerHTML = "";
    const safeItems = Array.isArray(items) && items.length > 0 ? items : ["None noted."];
    safeItems.forEach((text) => {
      const li = document.createElement("li");
      li.textContent = text;
      ulElement.appendChild(li);
    });
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

  function renderResults(payload) {
    const result = payload.result;
    const sources = payload.sources || [];

    // Specimen Title from notebook_update
    const entryTitle =
      (result.notebook_update && result.notebook_update.entry_title) || "Earth Specimen Report";
    resultsHeading.textContent = entryTitle;

    // Signal Classification
    const sigType = result.signal_type || "no_signal";
    const meta = SIGNAL_META[sigType] || SIGNAL_META.no_signal;

    signalCard.className = `result-card signal-card ${meta.cardClass}`;
    signalBadge.className = `signal-badge ${meta.badgeClass}`;
    signalBadge.textContent = meta.label;
    signalSummary.textContent = result.signal_summary || "";

    // Zzorp Says
    zzorpReaction.textContent = result.zzorp_reaction || "";

    // Lists
    populateBulletList(visibleFactsList, result.visible_facts);
    populateBulletList(inferencesList, result.inferences);
    populateBulletList(missingInfoList, result.missing_information);

    // Mission (nullable)
    if (result.mission && typeof result.mission === "object") {
      missionInstruction.textContent = result.mission.instruction || "";
      missionPhotoTarget.textContent = result.mission.photo_to_bring_back || "";
      if (result.mission.ask_an_adult === true) {
        askAdultBadge.classList.remove("hidden");
      } else {
        askAdultBadge.classList.add("hidden");
      }
      missionCard.classList.remove("hidden");
    } else {
      missionCard.classList.add("hidden");
    }

    // Zzorp's Sources
    renderSources(sources);

    // Switch to Screen 2
    scannerScreen.classList.add("hidden");
    resultsScreen.classList.remove("hidden");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function submitScan() {
    if (!currentBase64Jpeg) return;

    hideError();
    scanBtn.disabled = true;
    startWaitingAnimation();

    try {
      const response = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image_base64: currentBase64Jpeg,
          mime_type: "image/jpeg",
          scan_type: "first_scan",
        }),
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
      renderResults(data);
    } catch (_) {
      stopWaitingAnimation();
      showError(
        "My instruments are confused — could not reach the ship's computer. Please try again!"
      );
      scanBtn.disabled = false;
    }
  }

  function resetToScanner() {
    currentBase64Jpeg = null;
    imageInput.value = "";
    cameraInput.value = "";
    imagePreview.src = "";
    previewContainer.classList.add("hidden");
    emptyUploadPrompt.classList.remove("hidden");
    scanBtn.disabled = true;
    hideError();

    resultsScreen.classList.add("hidden");
    scannerScreen.classList.remove("hidden");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // Event Listeners
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

  // Initialize
  checkHealth();
})();
