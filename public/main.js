let sessionId = null;
let uploadedFile = null;
let originalMetadata = {};
let currentCoverData = null;
let coverChanged = false;

let coverSearchResults = [];
let coverSearchPage = 0;

// Track if authors came as array from server
let authorsIsArray = false;

// Session timing management (Part 2B)
let sessionStartTime = null;
let sessionWarningTimer = null;
let sessionWarningDismissed = false;
const SESSION_WARNING_MS = 25 * 60 * 1000; // 25 minutes
const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

// Start session timer when file is uploaded
function startSessionTimer() {
  sessionStartTime = Date.now();
  sessionWarningDismissed = false;
  
  // Clear any existing timer
  if (sessionWarningTimer) {
    clearInterval(sessionWarningTimer);
  }
  
  // Check session status every 30 seconds
  sessionWarningTimer = setInterval(checkSessionStatus, 30000);
  
  // Hide any existing warning
  document.getElementById('sessionWarningBanner').classList.add('hidden');
}

// Check if session is approaching expiry
function checkSessionStatus() {
  if (!sessionStartTime || sessionWarningDismissed) return;
  
  const elapsed = Date.now() - sessionStartTime;
  
  // Show warning at 25-minute mark
  if (elapsed >= SESSION_WARNING_MS && elapsed < SESSION_TIMEOUT_MS) {
    showSessionWarning();
  }
  
  // Session expired - clear and notify
  if (elapsed >= SESSION_TIMEOUT_MS) {
    sessionExpired();
  }
}

// Show session expiry warning
function showSessionWarning() {
  const banner = document.getElementById('sessionWarningBanner');
  if (!banner.classList.contains('hidden')) return; // Already showing
  
  const remaining = Math.ceil((SESSION_TIMEOUT_MS - (Date.now() - sessionStartTime)) / 60000);
  const warningText = banner.querySelector('.session-warning-text');
  warningText.textContent = `⚠️ Your session will expire in ${remaining} minute${remaining !== 1 ? 's' : ''}. Please download your EPUB before the session ends.`;
  
  banner.classList.remove('hidden');
}

// User dismissed the warning
function dismissSessionWarning() {
  document.getElementById('sessionWarningBanner').classList.add('hidden');
  sessionWarningDismissed = true;
}

// Handle session expiry
function sessionExpired() {
  // Clear the interval
  if (sessionWarningTimer) {
    clearInterval(sessionWarningTimer);
    sessionWarningTimer = null;
  }
  
  // Clear session data
  sessionId = null;
  sessionStartTime = null;
  
  // Update warning banner to show expired message
  const banner = document.getElementById('sessionWarningBanner');
  const warningText = banner.querySelector('.session-warning-text');
  warningText.textContent = '❌ Your session has expired. Please upload your EPUB file again to continue editing.';
  banner.classList.remove('hidden');
  
  // Hide dismiss button since this is a permanent state
  const dismissBtn = banner.querySelector('.session-warning-dismiss');
  if (dismissBtn) dismissBtn.style.display = 'none';
}

// Clean up on page unload
window.addEventListener('beforeunload', () => {
  if (sessionWarningTimer) {
    clearInterval(sessionWarningTimer);
  }
});

const uploadZone = document.getElementById('uploadZone');
const fileInput = document.getElementById('file');

// Dark mode
function toggleTheme() {
  document.body.classList.toggle('dark-mode');
  const isDark = document.body.classList.contains('dark-mode');
  localStorage.setItem('darkMode', isDark);
  document.getElementById('themeToggle').textContent = isDark ? '☀️' : '🌙';
}

// Load saved theme
if (localStorage.getItem('darkMode') === 'true') {
  document.body.classList.add('dark-mode');
  document.getElementById('themeToggle').textContent = '☀️';
}

// Tooltip functionality
const tooltip = document.getElementById('tooltip');

document.querySelectorAll('.tooltip-trigger').forEach(trigger => {
  trigger.addEventListener('mouseenter', (e) => {
    const text = e.target.dataset.tooltip;
    if (text) {
      tooltip.textContent = text;
      tooltip.classList.add('visible');
      
      const rect = e.target.getBoundingClientRect();
      tooltip.style.left = rect.left + (rect.width / 2) - (tooltip.offsetWidth / 2) + 'px';
      tooltip.style.top = rect.bottom + 8 + 'px';
      
      // Keep tooltip within viewport
      const tooltipRect = tooltip.getBoundingClientRect();
      if (tooltipRect.right > window.innerWidth) {
        tooltip.style.left = (window.innerWidth - tooltipRect.width - 10) + 'px';
      }
      if (tooltipRect.left < 0) {
        tooltip.style.left = '10px';
      }
    }
  });
  
  trigger.addEventListener('mouseleave', () => {
    tooltip.classList.remove('visible');
  });
});

// Drag and drop
uploadZone.addEventListener('click', () => fileInput.click());
uploadZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  uploadZone.classList.add('dragover');
});
uploadZone.addEventListener('dragleave', () => {
  uploadZone.classList.remove('dragover');
});
uploadZone.addEventListener('drop', (e) => {
  e.preventDefault();
  uploadZone.classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  if (file && file.name.endsWith('.epub')) {
    handleFile(file);
  }
});

fileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) handleFile(file);
});

document.getElementById('coverInput').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      currentCoverData = e.target.result.split(',')[1]; // Get base64 without prefix
      document.getElementById('coverPreview').innerHTML = 
        `<img src="data:image/jpeg;base64,${currentCoverData}" alt="Cover">`;
      coverChanged = true;
      updateDiffPreview();
      updateOPDSPreview();
    };
    reader.readAsDataURL(file);
  }
});

function showWarnings(warnings) {
  const banner = document.getElementById('warningsBanner');
  if (!warnings || warnings.length === 0) {
    banner.classList.add('hidden');
    return;
  }
  
  banner.innerHTML = warnings.map(w => `<div class="warning-item">⚠️ ${escapeHtml(w)}</div>`).join('');
  banner.classList.remove('hidden');
}

async function handleFile(file) {
  uploadedFile = file;

  const form = new FormData();
  form.append('file', file);

  try {
    const res = await fetch('/upload', {
      method: 'POST',
      body: form
    });

    if (!res.ok) {
      const error = await res.json();
      alert(error.error || 'Upload failed');
      return;
    }

    const data = await res.json();
    sessionId = data.sessionId;
    const m = data.meta || {};
    originalMetadata = data.originalMeta || m;
    currentCoverData = data.cover;
    
    // Start session timer (Part 2B)
    startSessionTimer();
    
    // Track if authors are arrays
    authorsIsArray = Array.isArray(m.authors) && m.authors.length > 0;

    // Populate fields
    document.getElementById('title').value = m.title || '';
    document.getElementById('subtitle').value = m.subtitle || '';
    
    // Handle authors array - join for display
    if (authorsIsArray) {
      document.getElementById('author').value = m.authors.map(a => 
        typeof a === 'string' ? a : a.name
      ).join(', ');
    } else {
      document.getElementById('author').value = m.author || '';
    }
    
    document.getElementById('contributors').value = m.contributors?.map(c => c.name).join(', ') || '';
    document.getElementById('language').value = m.language || '';
    document.getElementById('publisher').value = m.publisher || '';
    document.getElementById('date').value = m.date || '';
    document.getElementById('identifier').value = m.identifier || '';
    document.getElementById('series').value = m.series || '';
    document.getElementById('seriesIndex').value = m.seriesIndex || '';
    document.getElementById('description').value = m.description || '';
    document.getElementById('rights').value = m.rights || '';
    document.getElementById('subjects').value = (m.subjects || []).join(', ');

    // Show cover
    if (data.cover) {
      document.getElementById('coverPreview').innerHTML = 
        `<img src="data:image/jpeg;base64,${data.cover}" alt="Cover">`;
    }

    // Show any warnings
    showWarnings(data.warnings);

    document.getElementById('editor').classList.remove('hidden');
    updateDiffPreview();
    updateOPDSPreview();
  } catch (err) {
    console.error(err);
    alert('Failed to process EPUB');
  }
}

async function resetMetadata() {
  if (!originalMetadata) return;
  
  if (!confirm('Reset all metadata to original values?')) return;

  try {
    const res = await fetch('/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId })
    });

    if (res.ok) {
      const data = await res.json();
      const m = data.meta;
      
      // Repopulate fields
      document.getElementById('title').value = m.title || '';
      document.getElementById('subtitle').value = m.subtitle || '';
      
      // Handle authors array
      if (Array.isArray(m.authors) && m.authors.length > 0) {
        document.getElementById('author').value = m.authors.map(a => 
          typeof a === 'string' ? a : a.name
        ).join(', ');
      } else {
        document.getElementById('author').value = m.author || '';
      }
      
      document.getElementById('contributors').value = m.contributors?.map(c => c.name).join(', ') || '';
      document.getElementById('language').value = m.language || '';
      document.getElementById('publisher').value = m.publisher || '';
      document.getElementById('date').value = m.date || '';
      document.getElementById('identifier').value = m.identifier || '';
      document.getElementById('series').value = m.series || '';
      document.getElementById('seriesIndex').value = m.seriesIndex || '';
      document.getElementById('description').value = m.description || '';
      document.getElementById('rights').value = m.rights || '';
      document.getElementById('subjects').value = (m.subjects || []).join(', ');
      
      // Reset cover
      coverChanged = false;
      if (currentCoverData) {
        document.getElementById('coverPreview').innerHTML = 
          `<img src="data:image/jpeg;base64,${currentCoverData}" alt="Cover">`;
      }
      
      // Clear warnings
      showWarnings([]);
      
      updateDiffPreview();
      updateOPDSPreview();
    }
  } catch (err) {
    console.error(err);
    alert('Failed to reset metadata');
  }
}

let languageValidationTimeout = null;

async function validateLanguage() {
  const code = document.getElementById('language').value.trim();
  const warningEl = document.getElementById('languageWarning');
  
  // Debounce
  if (languageValidationTimeout) {
    clearTimeout(languageValidationTimeout);
  }
  
  if (!code) {
    warningEl.classList.add('hidden');
    return;
  }
  
  languageValidationTimeout = setTimeout(async () => {
    try {
      const res = await fetch(`/validate-language?code=${encodeURIComponent(code)}`);
      const result = await res.json();
      
      if (result.warning) {
        warningEl.textContent = result.warning;
        warningEl.classList.remove('hidden');
      } else if (result.converted) {
        warningEl.textContent = `Will be normalized to "${result.code}"`;
        warningEl.classList.remove('hidden');
        warningEl.classList.add('info');
      } else {
        warningEl.classList.add('hidden');
        warningEl.classList.remove('info');
      }
    } catch (err) {
      console.error(err);
    }
  }, 500);
}

function selectLanguage(value) {
  if (value) {
    document.getElementById('language').value = value;
    document.getElementById('languageSelect').value = ''; // Reset dropdown
    validateLanguage();
    updateDiffPreview();
  }
}

async function normalizeMetadata() {
  const metadata = getCurrentMetadata();
  
  try {
    const res = await fetch('/normalize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ metadata })
    });

    if (res.ok) {
      const data = await res.json();
      const m = data.metadata;
      
      // Update fields with normalized values
      document.getElementById('title').value = m.title || '';
      document.getElementById('subtitle').value = m.subtitle || '';
      document.getElementById('author').value = m.author || '';
      document.getElementById('contributors').value = m.contributors || '';
      document.getElementById('language').value = m.language || '';
      document.getElementById('publisher').value = m.publisher || '';
      document.getElementById('date').value = m.date || '';
      document.getElementById('identifier').value = m.identifier || '';
      document.getElementById('series').value = m.series || '';
      document.getElementById('seriesIndex').value = m.seriesIndex || '';
      document.getElementById('description').value = m.description || '';
      document.getElementById('rights').value = m.rights || '';
      document.getElementById('subjects').value = (m.subjects || []).join(', ');
      
      // Show any warnings from normalization
      if (data.warnings && data.warnings.length > 0) {
        showWarnings(data.warnings);
      }
      
      updateDiffPreview();
      updateOPDSPreview();
    }
  } catch (err) {
    console.error(err);
    alert('Failed to normalize metadata');
  }
}

async function optimizeCover() {
  if (!currentCoverData) {
    alert('No cover image to optimize');
    return;
  }
  
  const btn = document.getElementById('optimizeBtn');
  btn.disabled = true;
  btn.textContent = '⏳ Processing...';
  
  try {
    const res = await fetch('/optimize-cover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cover: currentCoverData })
    });

    if (res.ok) {
      const data = await res.json();
      currentCoverData = data.cover;
      document.getElementById('coverPreview').innerHTML = 
        `<img src="data:image/jpeg;base64,${data.cover}" alt="Cover">`;
      coverChanged = true;
      updateDiffPreview();
      updateOPDSPreview();
    }
  } catch (err) {
    console.error(err);
    alert('Failed to optimize cover');
  } finally {
    btn.disabled = false;
    btn.textContent = '⚡ Compress';
  }
}

async function lookupISBN() {
  const isbn = document.getElementById('identifier').value.trim();
  if (!isbn) {
    alert('Please enter an ISBN');
    return;
  }

  const btn = document.getElementById('lookupBtn');
  btn.disabled = true;
  document.getElementById('lookupText').innerHTML = '<span class="spinner"></span> Looking up...';

  try {
    const res = await fetch(`/lookup-isbn?isbn=${encodeURIComponent(isbn)}`);
    const data = await res.json();

    if (data.candidates && data.candidates.length > 0) {
      showCandidatesModal(data.candidates);
      // Show warnings if some sources failed (Task 4)
      if (data.errors && data.errors.length > 0) {
        const errorMsgs = data.errors.map(e => e.message || `${e.source}: Error`).join('\n');
        console.warn('Partial lookup failures:', errorMsgs);
      }
    } else {
      // Show detailed error message (Task 4)
      let msg = 'No metadata found for this ISBN';
      if (data.errors && data.errors.length > 0) {
        const errorDetails = data.errors.map(e => e.message || `${e.source}: unavailable`).join('; ');
        msg += '\n\nDetails: ' + errorDetails;
      }
      alert(msg);
    }
  } catch (err) {
    console.error(err);
    alert('Lookup failed - please check your network connection');
  } finally {
    btn.disabled = false;
    document.getElementById('lookupText').textContent = 'Lookup';
  }
}

async function searchByTitle() {
  const title = document.getElementById('titleSearch').value.trim() || 
                document.getElementById('title').value.trim();
  
  if (!title) {
    alert('Please enter a title');
    return;
  }

  const btn = document.getElementById('searchBtn');
  btn.disabled = true;
  document.getElementById('searchText').innerHTML = '<span class="spinner"></span> Searching...';

  try {
    const res = await fetch(`/search-title?title=${encodeURIComponent(title)}`);
    const data = await res.json();

    if (data.candidates && data.candidates.length > 0) {
      showCandidatesModal(data.candidates);
      // Show warnings if some sources failed (Task 4)
      if (data.errors && data.errors.length > 0) {
        const errorMsgs = data.errors.map(e => e.message || `${e.source}: Error`).join('\n');
        console.warn('Partial search failures:', errorMsgs);
      }
    } else {
      // Show detailed error message (Task 4)
      let msg = 'No results found';
      if (data.errors && data.errors.length > 0) {
        const errorDetails = data.errors.map(e => e.message || `${e.source}: unavailable`).join('; ');
        msg += '\n\nDetails: ' + errorDetails;
      }
      alert(msg);
    }
  } catch (err) {
    console.error(err);
    alert('Search failed - please check your network connection');
  } finally {
    btn.disabled = false;
    document.getElementById('searchText').textContent = 'Search';
  }
}

function showCandidatesModal(candidates) {
  const modal = document.getElementById('candidatesModal');
  const list = document.getElementById('candidatesList');
  
  // ---- replace the template builder with this block (Task 10A) ----
  list.innerHTML = candidates.map((candidate, idx) => {
    // Build list of all available fields (unchanged)
    const fields = [];
    if (candidate.title) fields.push(`<strong>Title:</strong> ${escapeHtml(candidate.title)}`);
    if (candidate.author) fields.push(`<strong>Author:</strong> ${escapeHtml(candidate.author)}`);
    if (candidate.isbn) fields.push(`<strong>ISBN:</strong> ${escapeHtml(candidate.isbn)}`);
    if (candidate.publisher) fields.push(`<strong>Publisher:</strong> ${escapeHtml(candidate.publisher)}`);
    if (candidate.date) fields.push(`<strong>Date:</strong> ${escapeHtml(candidate.date)}`);
    if (candidate.language) fields.push(`<strong>Language:</strong> ${escapeHtml(candidate.language)}`);
    if (candidate.description) {
      const desc = candidate.description.substring(0, 200);
      fields.push(`<strong>Description:</strong> ${escapeHtml(desc)}${candidate.description.length > 200 ? '...' : ''}`);
    }
    if (candidate.subjects && candidate.subjects.length) {
      fields.push(`<strong>Subjects:</strong> ${candidate.subjects.map(s => escapeHtml(s)).join(', ')}`);
    }

    const noISBNNote = (!candidate.isbn && candidate.source === 'Apple Books')
      ? '<div class="candidate-note">Note: Apple Books results do not include ISBN</div>'
      : '';

    // New responsive card structure: content left, cover right (desktop)
    return `
      <div class="candidate-card">
        <div class="candidate-main">
          <div class="candidate-header">
            <div class="candidate-title-block">
              <div class="candidate-title-row">
                <strong class="candidate-title">${escapeHtml(candidate.title || 'Unknown Title')}</strong>
                <span class="source-badge">${escapeHtml(candidate.source || 'Unknown')}</span>
              </div>


            </div>
          </div>

          <div class="candidate-details">
            ${fields.map(f => `<div>${f}</div>`).join('')}
            ${noISBNNote}
          </div>

          <div class="candidate-actions">
            <button class="btn btn-primary btn-small" onclick="applyCandidate(${idx})">
              Apply All Fields
            </button>
            <button class="btn btn-secondary btn-small" onclick="selectiveApply(${idx})">
              Select Fields
            </button>
          </div>
        </div>

        <div class="candidate-cover-wrap" aria-hidden="${candidate.coverUrl ? 'false' : 'true'}">
          ${candidate.coverUrl
            ? `<img src="${candidate.coverUrl}" alt="Cover for ${escapeHtml(candidate.title || 'candidate')}" class="candidate-cover">`
            : `<div class="candidate-cover placeholder">No image</div>`}
        </div>
      </div>
    `;
  }).join('');
  
  modal.classList.remove('hidden');
  window.currentCandidates = candidates;
}

function closeCandidatesModal() {
  document.getElementById('candidatesModal').classList.add('hidden');
}

function applyCandidate(idx) {
  const candidate = window.currentCandidates[idx];
  
  if (candidate.title) document.getElementById('title').value = candidate.title;
  if (candidate.author) document.getElementById('author').value = candidate.author;
  // Only apply ISBN if it exists (Apple Books won't have one)
  if (candidate.isbn) document.getElementById('identifier').value = candidate.isbn;
  if (candidate.publisher) document.getElementById('publisher').value = candidate.publisher;
  if (candidate.date) document.getElementById('date').value = candidate.date;
  if (candidate.language) document.getElementById('language').value = candidate.language;
  if (candidate.description) document.getElementById('description').value = candidate.description;
  if (candidate.subjects && candidate.subjects.length) {
    document.getElementById('subjects').value = candidate.subjects.join(', ');
  }
  
  closeCandidatesModal();
  updateDiffPreview();
  updateOPDSPreview();
}

function selectiveApply(idx) {
  const candidate = window.currentCandidates[idx];
  const fields = [];
  
  if (candidate.title) fields.push({ key: 'title', label: 'Title', value: candidate.title });
  if (candidate.author) fields.push({ key: 'author', label: 'Author', value: candidate.author });
  // Only show ISBN if it exists
  if (candidate.isbn) fields.push({ key: 'identifier', label: 'ISBN', value: candidate.isbn });
  if (candidate.publisher) fields.push({ key: 'publisher', label: 'Publisher', value: candidate.publisher });
  if (candidate.date) fields.push({ key: 'date', label: 'Date', value: candidate.date });
  if (candidate.language) fields.push({ key: 'language', label: 'Language', value: candidate.language });
  if (candidate.description) fields.push({ key: 'description', label: 'Description', value: candidate.description });
  if (candidate.subjects) fields.push({ key: 'subjects', label: 'Subjects', value: candidate.subjects.join(', ') });
  
  const list = document.getElementById('candidatesList');
  list.innerHTML = `
    <div class="field-selector">
      <h4>Select fields to apply:</h4>
      ${fields.map(f => `
        <label class="field-checkbox">
          <input type="checkbox" value="${f.key}" checked>
          <strong>${f.label}:</strong> ${escapeHtml(f.value.substring(0, 100))}${f.value.length > 100 ? '...' : ''}
        </label>
      `).join('')}
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="showCandidatesModal(window.currentCandidates)">Back</button>
        <button class="btn btn-primary" onclick="applySelectedFields(${idx})">Apply Selected</button>
      </div>
    </div>
  `;
}

function applySelectedFields(idx) {
  const candidate = window.currentCandidates[idx];
  const checkboxes = document.querySelectorAll('.field-checkbox input:checked');
  
  checkboxes.forEach(cb => {
    const key = cb.value;
    const value = candidate[key];
    if (value) {
      if (key === 'subjects' && Array.isArray(value)) {
        document.getElementById(key).value = value.join(', ');
      } else {
        document.getElementById(key).value = value;
      }
    }
  });
  
  closeCandidatesModal();
  updateDiffPreview();
  updateOPDSPreview();
}

async function showCoverSearch() {
  const title = document.getElementById('title').value.trim();
  const isbn = document.getElementById('identifier').value.trim();
  
  if (!title && !isbn) {
    alert('Please enter a title or ISBN first');
    return;
  }
  
  const modal = document.getElementById('coverModal');
  const list = document.getElementById('coversList');
  const modalTitle = document.getElementById('coverModalTitle');
  
  modalTitle.textContent = '🖼️ Select Cover Image';
  list.innerHTML = '<div class="loading">🔍 Searching for covers...</div>';
  modal.classList.remove('hidden');
  
  try {
    const params = new URLSearchParams();
    if (title) params.append('query', title);
    if (isbn) params.append('isbn', isbn);
    
    const res = await fetch(`/search-covers?${params}`);
    const data = await res.json();
    
    if (data.covers && data.covers.length > 0) {
      coverSearchResults = data.covers;
      coverSearchPage = 0;
      modalTitle.textContent = `🖼️ Select Cover Image (${data.covers.length} results)`;
      displayCoverPage();
    } else {
      list.innerHTML = '<div class="no-results">No covers found</div>';
    }
  } catch (err) {
    console.error(err);
    list.innerHTML = '<div class="error">Failed to search for covers</div>';
  }
}

function displayCoverPage() {
  const list = document.getElementById('coversList');
  const itemsPerPage = 6;
  const totalPages = Math.ceil(coverSearchResults.length / itemsPerPage);
  const start = coverSearchPage * itemsPerPage;
  const end = start + itemsPerPage;
  const pageCovers = coverSearchResults.slice(start, end);
  
  list.innerHTML = pageCovers.map((cover, idx) => `
    <div class="cover-option" onclick="selectCover('${cover.url}')">
      <img src="${cover.url}" alt="Cover option" loading="lazy" onerror="this.parentElement.style.display='none'">
      <div class="cover-info">
        <div><strong>${escapeHtml(cover.source)}</strong></div>
        <div class="cover-desc">${escapeHtml(cover.description)}</div>
      </div>
    </div>
  `).join('');
  
  // Add pagination controls if needed
  if (totalPages > 1) {
    const paginationHTML = `
      <div class="cover-pagination">
        <button 
          class="btn btn-secondary btn-small" 
          onclick="changeCoverPage(-1)" 
          ${coverSearchPage === 0 ? 'disabled' : ''}
        >
          ← Previous
        </button>
        <span class="page-indicator">Page ${coverSearchPage + 1} of ${totalPages}</span>
        <button 
          class="btn btn-secondary btn-small" 
          onclick="changeCoverPage(1)" 
          ${coverSearchPage === totalPages - 1 ? 'disabled' : ''}
        >
          Next →
        </button>
      </div>
    `;
    list.insertAdjacentHTML('beforeend', paginationHTML);
  }
}

function changeCoverPage(direction) {
  coverSearchPage += direction;
  displayCoverPage();
}

function closeCoverModal() {
  document.getElementById('coverModal').classList.add('hidden');
}

async function selectCover(url) {
  closeCoverModal();
  
  try {
    const res = await fetch('/fetch-cover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, optimize: true })
    });
    
    if (res.ok) {
      const data = await res.json();
      currentCoverData = data.cover;
      document.getElementById('coverPreview').innerHTML = 
        `<img src="data:image/jpeg;base64,${data.cover}" alt="Cover">`;
      coverChanged = true;
      updateDiffPreview();
      updateOPDSPreview();
    }
  } catch (err) {
    console.error(err);
    alert('Failed to fetch cover');
  }
}

function getCurrentMetadata() {
  const authorValue = document.getElementById('author').value.trim();
  
  // Split authors by comma for array format
  const authorsArray = authorValue.split(',').map(a => a.trim()).filter(a => a);
  
  return {
    title: document.getElementById('title').value.trim(),
    subtitle: document.getElementById('subtitle').value.trim(),
    author: authorValue, // Keep single string for backward compat
    authors: authorsArray.map(name => ({ name })), // Array format for EPUB 3
    contributors: document.getElementById('contributors').value.trim(),
    language: document.getElementById('language').value.trim(),
    publisher: document.getElementById('publisher').value.trim(),
    date: document.getElementById('date').value.trim(),
    identifier: document.getElementById('identifier').value.trim(),
    series: document.getElementById('series').value.trim(),
    seriesIndex: document.getElementById('seriesIndex').value.trim(),
    description: document.getElementById('description').value.trim(),
    rights: document.getElementById('rights').value.trim(),
    subjects: document.getElementById('subjects').value.split(',').map(s => s.trim()).filter(s => s)
  };
}

function updateDiffPreview() {
  const current = getCurrentMetadata();
  const changes = [];

  // Compare relevant fields
  const fieldsToCompare = ['title', 'subtitle', 'author', 'language', 'publisher', 'date', 'identifier', 
                          'series', 'seriesIndex', 'description', 'rights', 'subjects'];
  
  fieldsToCompare.forEach(key => {
    let oldVal = originalMetadata[key];
    let newVal = current[key];
    
    // Handle authors array
    if (key === 'author' && Array.isArray(originalMetadata.authors)) {
      oldVal = originalMetadata.authors.map(a => typeof a === 'string' ? a : a.name).join(', ');
    }
    
    // Convert arrays to strings for comparison
    if (Array.isArray(oldVal)) {
      oldVal = oldVal.join(', ');
    }
    if (Array.isArray(newVal)) {
      newVal = newVal.join(', ');
    }
    
    oldVal = oldVal || '';
    newVal = newVal || '';

    if (oldVal !== newVal) {
      // Format field name - special case for "description" to show as "Summary"
      let fieldName = key.charAt(0).toUpperCase() + key.slice(1).replace(/([A-Z])/g, ' $1');
      if (key === 'description') {
        fieldName = 'Summary';
      }
      
      changes.push({
        field: fieldName,
        old: oldVal,
        new: newVal
      });
    }
  });

  if (coverChanged) {
    changes.push({
      field: 'Cover',
      old: 'Original',
      new: 'Updated'
    });
  }

  const preview = document.getElementById('diffPreview');
  if (changes.length === 0) {
    preview.classList.add('hidden');
  } else {
    preview.classList.remove('hidden');
    preview.innerHTML = `
      <div class="diff-preview">
        <h4>📋 Changes Preview</h4>
        ${changes.map(c => `
          <div class="diff-item">
            <div class="diff-field">${escapeHtml(c.field)}</div>
            <div class="diff-values">
              ${c.old ? `<div class="diff-old">${escapeHtml(c.old.substring(0, 100))}${c.old.length > 100 ? '...' : ''}</div>` : ''}
              <div class="diff-new">${escapeHtml(c.new.substring(0, 100))}${c.new.length > 100 ? '...' : ''}</div>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }
  
  // Update OPDS preview
  updateOPDSPreview();
}

function updateOPDSPreview() {
  const metadata = getCurrentMetadata();
  const opdsPreview = document.getElementById('opdsPreview');
  
  if (!opdsPreview) return;
  
  const title = metadata.title || 'Untitled Book';
  const subtitle = metadata.subtitle || '';
  const author = metadata.author || 'Unknown Author';
  const year = metadata.date ? metadata.date.substring(0, 4) : '';
  const publisher = metadata.publisher || '';
  const series = metadata.series || '';
  const seriesIndex = metadata.seriesIndex ? `#${metadata.seriesIndex}` : '';
  const language = metadata.language || '';
  const subjects = metadata.subjects || [];
  const description = metadata.description || '';
  
  // Build metadata line
  const metaParts = [];
  if (series) {
    metaParts.push(`${series}${seriesIndex ? ' ' + seriesIndex : ''}`);
  }
  if (publisher) {
    metaParts.push(publisher);
  }
  if (year) {
    metaParts.push(year);
  }
  
  const metaLine = metaParts.join(' • ') || 'No additional info';
  
  // Build subjects line - show all subjects
  const subjectsLine = subjects.length > 0 
    ? subjects.join(', ')
    : '';
  
  // Truncate description to 240 chars
  const descPreview = description 
    ? (description.length > 240 ? description.substring(0, 240) + '...' : description)
    : '';
  
  // Generate cover HTML
  const coverHTML = currentCoverData 
    ? `<img src="data:image/jpeg;base64,${currentCoverData}" alt="Cover">` 
    : '<div class="opds-cover-placeholder">?</div>';
  
  opdsPreview.innerHTML = `
    <div class="opds-item">
      <div class="opds-cover-mini">
        ${coverHTML}
      </div>
      <div class="opds-details">
        <div class="opds-title">${escapeHtml(title)}</div>
        ${subtitle ? `<div class="opds-subtitle">${escapeHtml(subtitle)}</div>` : ''}
        <div class="opds-author">${escapeHtml(author)}</div>
        <div class="opds-meta">${escapeHtml(metaLine)}</div>
        ${language ? `<div class="opds-language">Language: ${escapeHtml(language)}</div>` : ''}
        ${subjectsLine ? `<div class="opds-subjects">Categories: ${escapeHtml(subjectsLine)}</div>` : ''}
        ${descPreview ? `<div class="opds-description">${escapeHtml(descPreview)}</div>` : ''}
      </div>
    </div>
  `;
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

async function downloadEPUB() {
  if (!sessionId) {
    alert('Please upload a file first');
    return;
  }

  const btn = document.getElementById('downloadBtn');
  btn.disabled = true;
  document.getElementById('downloadText').innerHTML = '<span class="spinner"></span> Processing...';

  try {
    const metadata = getCurrentMetadata();
    
    const res = await fetch('/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        metadata,
        cover: currentCoverData,
        coverChanged
      })
    });

    if (!res.ok) {
      throw new Error('Download failed');
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = uploadedFile.name;
    a.click();
    URL.revokeObjectURL(url);

  } catch (err) {
    console.error(err);
    alert('Failed to create EPUB');
  } finally {
    btn.disabled = false;
    document.getElementById('downloadText').textContent = '💾 Download Cleaned EPUB';
  }
}