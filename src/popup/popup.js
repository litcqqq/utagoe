/**
 * Spotify Japanese Lyrics Romaji Extension
 * Settings popup logic: Validation status, Ateji toggles, and Custom Dictionary Manager.
 */

document.addEventListener('DOMContentLoaded', () => {
  // Elements
  const toggleEnabled = document.getElementById('toggle-enabled');
  const fontSizeSlider = document.getElementById('font-size-slider');
  const fontSizeValue = document.getElementById('font-size-value');
  const selectSystem = document.getElementById('select-system');
  const selectCasing = document.getElementById('select-casing');
  const toggleValidator = document.getElementById('toggle-validator');
  const toggleAteji = document.getElementById('toggle-ateji');

  const selectOutputMode = document.getElementById('select-output-mode');
  const toggleTapToFix = document.getElementById('toggle-tap-to-fix');
  const toggleBadges = document.getElementById('toggle-badges');
  const btnExportVocab = document.getElementById('btn-export-vocab');
  const exportHint = document.getElementById('export-hint');

  const sourceBadge = document.getElementById('source-badge');
  const statusTrackName = document.getElementById('status-track-name');

  const formAddOverride = document.getElementById('form-add-override');
  const inputKanji = document.getElementById('input-kanji');
  const inputRomaji = document.getElementById('input-romaji');
  const dictList = document.getElementById('dict-list');
  const dictCount = document.getElementById('dict-count');
  const dictEmptyHint = document.getElementById('dict-empty-hint');

  const previewBox = document.getElementById('preview-box');
  const previewRomaji = document.getElementById('preview-romaji');

  // Preview samples for each romanization system
  const PREVIEW_SAMPLES = {
    hepburn: 'shizumu yō ni toke te yuku yō ni',
    passport: 'shizumu yo ni toke te yuku yo ni'
  };

  let currentOverrides = {};

  // Update preview card based on form values
  function updatePreview() {
    const ratio = parseInt(fontSizeSlider.value, 10) / 100;
    fontSizeValue.textContent = `${fontSizeSlider.value}%`;
    document.documentElement.style.setProperty('--preview-font-ratio', ratio.toString());

    const isEnabled = toggleEnabled.checked;
    if (previewBox) {
      previewBox.style.opacity = isEnabled ? '1' : '0.45';
    }

    const system = selectSystem.value;
    let sample = PREVIEW_SAMPLES[system] || PREVIEW_SAMPLES.hepburn;
    if (selectCasing.value === 'lowercase') {
      sample = sample.toLowerCase();
    }
    previewRomaji.textContent = sample;
  }

  // Render Custom Overrides Dictionary List
  function renderDictionary() {
    const entries = Object.entries(currentOverrides);
    dictCount.textContent = `${entries.length} word${entries.length === 1 ? '' : 's'}`;

    // Clear existing item rows (keeping empty hint)
    dictList.querySelectorAll('.dict-item-row').forEach(el => el.remove());

    if (entries.length === 0) {
      dictEmptyHint.style.display = 'block';
      return;
    }

    dictEmptyHint.style.display = 'none';

    entries.forEach(([kanji, romaji]) => {
      const row = document.createElement('div');
      row.className = 'dict-item-row';

      const textSpan = document.createElement('div');
      textSpan.className = 'dict-item-text';

      const kanjiSpan = document.createElement('span');
      kanjiSpan.className = 'dict-item-kanji';
      kanjiSpan.textContent = kanji;

      const arrowSpan = document.createElement('span');
      arrowSpan.className = 'dict-item-arrow';
      arrowSpan.textContent = '→';

      const romajiSpan = document.createElement('span');
      romajiSpan.className = 'dict-item-romaji';
      romajiSpan.textContent = romaji;

      textSpan.appendChild(kanjiSpan);
      textSpan.appendChild(arrowSpan);
      textSpan.appendChild(romajiSpan);

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'dict-item-delete';
      deleteBtn.textContent = '×';
      deleteBtn.title = `Remove correction "${kanji}"`;
      deleteBtn.addEventListener('click', () => {
        delete currentOverrides[kanji];
        chrome.storage.local.set({ customOverrides: currentOverrides }, () => {
          renderDictionary();
        });
      });

      row.appendChild(textSpan);
      row.appendChild(deleteBtn);
      dictList.appendChild(row);
    });
  }

  // Update Status Card based on lastTrackStatus
  function updateStatusCard(trackStatus) {
    if (!trackStatus || !trackStatus.title) {
      statusTrackName.textContent = 'Open the lyrics tab on Spotify / YT Music...';
      sourceBadge.textContent = 'Standby';
      sourceBadge.className = 'status-source-badge';
      return;
    }

    statusTrackName.textContent = `${trackStatus.title}${trackStatus.artist ? ' - ' + trackStatus.artist : ''}`;

    if (trackStatus.source === 'lrclib') {
      sourceBadge.textContent = 'Verified (Lrclib)';
      sourceBadge.className = 'status-source-badge verified';
    } else {
      sourceBadge.textContent = 'Morphological transliteration';
      sourceBadge.className = 'status-source-badge';
    }
  }

  const VALID_OUTPUT_OPTIONS = new Set([
    'romaji',
    'furigana',
    'hiragana',
    'katakana',
    'translate:en',
    'translate:th',
    'translate:zh',
    'translate:id',
    'translate:ko',
    'translate:es',
    'translate:vi',
    'translate:fr',
    'translate:de',
    'translate:pt'
  ]);

  // Load saved settings from chrome.storage.local
  chrome.storage.local.get(
    {
      enabled: true,
      romajiSystem: 'hepburn',
      fontSizeRatio: 0.65,
      casing: 'normal',
      enableValidator: true,
      enableAteji: true,
      customOverrides: {},
      outputMode: 'romaji',
      translationLang: 'en',
      tapToFix: true,
      showBadges: true,
      lastTrackStatus: null
    },
    (items) => {
      toggleEnabled.checked = items.enabled !== false;
      const ratioPercent = Math.round(items.fontSizeRatio * 100);
      fontSizeSlider.value = ratioPercent;
      selectSystem.value = items.romajiSystem || 'hepburn';
      selectCasing.value = items.casing || 'normal';

      toggleValidator.checked = items.enableValidator !== false;
      toggleAteji.checked = items.enableAteji !== false;

      const candidateMode = items.outputMode === 'translate'
        ? `translate:${items.translationLang || 'en'}`
        : (items.outputMode || 'romaji');
      selectOutputMode.value = VALID_OUTPUT_OPTIONS.has(candidateMode) ? candidateMode : 'romaji';
      if (!selectOutputMode.value) selectOutputMode.value = 'romaji';

      toggleTapToFix.checked = items.tapToFix !== false;
      toggleBadges.checked = items.showBadges !== false;

      currentOverrides = items.customOverrides || {};
      renderDictionary();

      updateStatusCard(items.lastTrackStatus);
      updatePreview();
    }
  );

  // Form submit: Add Custom Word Override
  formAddOverride.addEventListener('submit', (e) => {
    e.preventDefault();
    const kanji = inputKanji.value.trim();
    const romaji = inputRomaji.value.trim();

    if (!kanji || !romaji) return;

    currentOverrides[kanji] = romaji;
    chrome.storage.local.set({ customOverrides: currentOverrides }, () => {
      renderDictionary();
      inputKanji.value = '';
      inputRomaji.value = '';
      inputKanji.focus();
    });
  });

  // Settings change event listeners
  toggleEnabled.addEventListener('change', () => {
    chrome.storage.local.set({ enabled: toggleEnabled.checked });
    updatePreview();
  });

  fontSizeSlider.addEventListener('input', () => {
    const ratio = parseInt(fontSizeSlider.value, 10) / 100;
    chrome.storage.local.set({ fontSizeRatio: ratio });
    updatePreview();
  });

  selectSystem.addEventListener('change', () => {
    chrome.storage.local.set({ romajiSystem: selectSystem.value });
    updatePreview();
  });

  selectCasing.addEventListener('change', () => {
    chrome.storage.local.set({ casing: selectCasing.value });
    updatePreview();
  });

  toggleValidator.addEventListener('change', () => {
    chrome.storage.local.set({ enableValidator: toggleValidator.checked });
  });

  toggleAteji.addEventListener('change', () => {
    chrome.storage.local.set({ enableAteji: toggleAteji.checked });
  });

  selectOutputMode.addEventListener('change', () => {
    const val = selectOutputMode.value || 'romaji';
    if (val.startsWith('translate:')) {
      const lang = val.slice('translate:'.length) || 'en';
      chrome.storage.local.set({ outputMode: 'translate', translationLang: lang });
    } else {
      chrome.storage.local.set({ outputMode: val });
    }
  });

  toggleTapToFix.addEventListener('change', () => {
    chrome.storage.local.set({ tapToFix: toggleTapToFix.checked });
  });

  toggleBadges.addEventListener('change', () => {
    chrome.storage.local.set({ showBadges: toggleBadges.checked });
  });

  /**
   * The popup has no DOM access to the music page, so it asks the content
   * script of the active tab to build and download the CSV. Feedback is shown
   * in the hint line because a popup closes as soon as a download starts.
   */
  btnExportVocab.addEventListener('click', () => {
    btnExportVocab.disabled = true;
    exportHint.textContent = 'Preparing vocabulary...';

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs && tabs[0];
      if (!tab || !tab.id) {
        exportHint.textContent = 'No active tab found.';
        btnExportVocab.disabled = false;
        return;
      }

      chrome.tabs.sendMessage(tab.id, { type: 'UTAGOE_EXPORT_VOCABULARY' }, (res) => {
        btnExportVocab.disabled = false;

        if (chrome.runtime.lastError) {
          exportHint.textContent = 'Open a Spotify or YouTube Music lyrics page first.';
          return;
        }
        if (!res || !res.ok) {
          exportHint.textContent = 'No lyrics loaded yet - start a song and try again.';
          return;
        }
        exportHint.textContent = `Exported ${res.count} line${res.count === 1 ? '' : 's'} to CSV.`;
      });
    });
  });


  // Listen to background/content status updates
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.lastTrackStatus) {
      updateStatusCard(changes.lastTrackStatus.newValue);
    }
  });
});
