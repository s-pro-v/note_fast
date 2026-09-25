/**
 * FastNote Manager - Industrial Technocracy Core z odizolowaną ramką iframe, 
 * potwierdzeniem usunięcia HUD oraz automatycznym commitem do GitHub.
 */

const initialNotesData = [
    {
        id: "c61f1425-0260-49de-8bd4-1f13536f4639",
        data: "2026-04-04T11:38:26.874Z",
        note: JSON.stringify({
            title: "biblioteki",
            content:
                '<link href="https://cdn.jsdelivr.net/gh/s-pro-v/Industrial_HUD_Framework@main/css/style.css" rel="stylesheet">\n' +
                '<link href="https://cdn.jsdelivr.net/gh/s-pro-v/Industrial_HUD_Framework@main/css/alert.css" rel="stylesheet">\n\n' +
                '<script src="https://cdn.jsdelivr.net/gh/s-pro-v/Industrial_HUD_Framework@main/js/main.js"></script>\n' +
                '<script src="https://cdn.jsdelivr.net/gh/s-pro-v/Industrial_HUD_Framework@main/js/industrial-hud.js"></script>\n\n' +
                '@import url("https://fonts.googleapis.com/css2?family=JetBrains+Mono&family=Share+Tech+Mono&display=swap");'
        })
    }
];

// Konfiguracja pobierania i deszyfracji tokena PAT z auth.json
const AUTH_STORE = {
    url: "https://raw.githubusercontent.com/s-pro-v/json-lista/refs/heads/main/dev/auth.json",
    get key() {
        return [119, 53, 103].map((c) => String.fromCharCode(c)).join(""); // "w5g"
    },
    targetField: "note_manager"
};

// Stan Aplikacji
let notes = [];
let selectedNoteId = null;
let searchQuery = "";
let currentFileSha = null;
let currentViewMode = "split";
let isSidebarCollapsed = false;
let currentDetectedLang = "plaintext";
let notePendingDeletion = null;
const diagLogs = [];

// Konfiguracja GitHub z LocalStorage
const storedConfig = localStorage.getItem("fastnote_gh_config");
let githubConfig = storedConfig
    ? JSON.parse(storedConfig)
    : {
        repo: "s-pro-v/fastnote",
        branch: "main",
        path: "s-note.json",
        token: "",
        rawUrl: "https://raw.githubusercontent.com/s-pro-v/fastnote/refs/heads/main/s-note.json",
        useCorsProxy: false
    };

// Selektory DOM
const root = document.documentElement;
const themeToggleBtn = document.getElementById("themeToggleBtn");
const appAside = document.getElementById("appAside");
const toggleSidebarBtn = document.getElementById("toggleSidebarBtn");
const searchInput = document.getElementById("searchInput");
const clearSearchBtn = document.getElementById("clearSearchBtn");
const notesListContainer = document.getElementById("notesListContainer");
const emptyDetailPlaceholder = document.getElementById("emptyDetailPlaceholder");
const activeNoteContainer = document.getElementById("activeNoteContainer");
const activeNoteId = document.getElementById("activeNoteId");
const activeNoteDate = document.getElementById("activeNoteDate");
const activeTitleInput = document.getElementById("activeTitleInput");
const activeContentInput = document.getElementById("activeContentInput");
const lineNumbersGutter = document.getElementById("lineNumbersGutter");
const editorWorkspace = document.getElementById("editorWorkspace");
const previewIframe = document.getElementById("previewIframe");
const modeEditBtn = document.getElementById("modeEditBtn");
const modeSplitBtn = document.getElementById("modeSplitBtn");
const modePreviewBtn = document.getElementById("modePreviewBtn");
const languageBadge = document.getElementById("languageBadge");
const charCountLabel = document.getElementById("charCountLabel");
const wordCountLabel = document.getElementById("wordCountLabel");
const lineCountLabel = document.getElementById("lineCountLabel");
const readingTimeLabel = document.getElementById("readingTimeLabel");
const saveStatusIndicator = document.getElementById("saveStatusIndicator");
const filteredCountText = document.getElementById("filteredCountText");
const repoStatusIndicator = document.getElementById("repoStatusIndicator");
const diagLogTerminal = document.getElementById("diagLogTerminal");
const fileShaBadge = document.getElementById("fileShaBadge");
const ghModalStatus = document.getElementById("ghModalStatus");
const toastContainer = document.getElementById("toastContainer");

// Modal usunięcia notatki
const deleteConfirmModal = document.getElementById("deleteConfirmModal");
const deleteConfirmTitle = document.getElementById("deleteConfirmTitle");
const deleteConfirmId = document.getElementById("deleteConfirmId");
const executeDeleteAndPushBtn = document.getElementById("executeDeleteAndPushBtn");

// Pomocniki Kodowania UTF-8 Base64
function utf8ToBase64(str) {
    const bytes = new TextEncoder().encode(str);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

function base64ToUtf8(b64) {
    const binary = atob(b64.replace(/\s/g, ""));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder().decode(bytes);
}

function cleanBranchName(branch) {
    if (!branch) return "main";
    return branch.replace(/^refs\/heads\//, "").trim();
}

function getAuthHeaders(token) {
    const headers = {};
    if (token && token.trim()) {
        const cleanToken = token.trim();
        headers["Authorization"] =
            cleanToken.startsWith("Bearer ") || cleanToken.startsWith("token ")
                ? cleanToken
                : `Bearer ${cleanToken}`;
    }
    return headers;
}

/**
 * Deszyfracja XOR dla ciągu Base64 przy użyciu symetrycznego klucza
 */
function xorDecode(b64String, key = AUTH_STORE.key) {
    try {
        const raw = atob(b64String.trim());
        let decrypted = "";
        for (let i = 0; i < raw.length; i++) {
            decrypted += String.fromCharCode(raw.charCodeAt(i) ^ key.charCodeAt(i % key.length));
        }
        return decrypted;
    } catch (err) {
        throw new Error("Błąd deszyfracji XOR/Base64: " + err.message);
    }
}

/**
 * Automatyczne pobranie, odszyfrowanie i podstawienie PAT z auth.json
 */
async function loadNoteManagerToken(silent = false) {
    const loadBtn = document.getElementById("loadAuthPatBtn");
    if (loadBtn) {
        loadBtn.disabled = true;
        loadBtn.innerHTML = `<i data-lucide="loader-2" class="animate-spin"></i><span>DESZYFRACJA...</span>`;
        if (window.lucide) lucide.createIcons();
    }

    addDiagLog(`[AUTH_CORE]: Pobieranie zaszyfrowanego tokena z ${AUTH_STORE.url}`);

    try {
        const res = await fetch(`${AUTH_STORE.url}?t=${Date.now()}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);

        const authData = await res.json();
        const encryptedToken = authData[AUTH_STORE.targetField];

        if (!encryptedToken) {
            throw new Error(`Brak klucza "${AUTH_STORE.targetField}" w pliku auth.json`);
        }

        const decryptedPat = xorDecode(encryptedToken, AUTH_STORE.key);

        const ghTokenInput = document.getElementById("ghTokenInput");
        if (ghTokenInput) ghTokenInput.value = decryptedPat;

        githubConfig.token = decryptedPat;
        localStorage.setItem("fastnote_gh_config", JSON.stringify(githubConfig));

        addDiagLog(`[AUTH_CORE]: Pomyślnie zdekodowano "${AUTH_STORE.targetField}" -> Prefiks: ${decryptedPat.substring(0, 7)}...`, "ok");

        if (!silent) {
            showToast("Token note_manager został pomyślnie wczytany!", "success");
        }
        return decryptedPat;
    } catch (err) {
        addDiagLog(`[AUTH_CORE]: Błąd deszyfracji tokena: ${err.message}`, "error");
        if (!silent) {
            showToast(`Błąd wczytywania tokena: ${err.message}`, "error");
        }
    } finally {
        if (loadBtn) {
            loadBtn.disabled = false;
            loadBtn.innerHTML = `<i data-lucide="key"></i><span>POBIERZ Z AUTH.JSON</span>`;
            if (window.lucide) lucide.createIcons();
        }
    }
}

function showToast(message, type = "info") {
    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<div>[${type.toUpperCase()}] ${message}</div>`;
    toastContainer.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add("active"));
    setTimeout(() => {
        toast.classList.remove("active");
        setTimeout(() => toast.remove(), 300);
    }, 3500);
}

function renderDiagLogs() {
    if (!diagLogTerminal) return;
    const countEl = document.getElementById("diagLogCount");
    if (countEl) {
        countEl.textContent = `${diagLogs.length} ${diagLogs.length === 1 ? "WPIS" : "WPISÓW"}`;
    }
    if (diagLogs.length === 0) {
        diagLogTerminal.innerHTML = `
            <div class="diag-empty">
                <span class="diag-blink">></span> [ BRAK WPISÓW // TERMINAL GOTOWY DO MONITOROWANIA TRANSAKCJI ]
            </div>
        `;
        return;
    }
    diagLogTerminal.innerHTML = diagLogs.map((item) => {
        const safeMsg = escapeHtml(item.msg);
        const lvl = (item.level || "info").toLowerCase();
        return `
            <div class="diag-line diag-level-${lvl}">
                <span class="diag-time">[${item.time}]</span>
                <span class="diag-badge diag-badge-${lvl}">[${lvl.toUpperCase()}]</span>
                <span class="diag-msg">${safeMsg}</span>
            </div>
        `;
    }).join("");
    diagLogTerminal.scrollTop = diagLogTerminal.scrollHeight;
}

function addDiagLog(msg, level = "info") {
    const time = new Date().toLocaleTimeString();
    const line = `[${time}] [${level.toUpperCase()}] ${msg}`;
    diagLogs.push({ time, level, msg, text: line });
    renderDiagLogs();
}

// Obsługa natywnego edytora tekstu
function updateLineNumbers() {
    if (!activeContentInput || !lineNumbersGutter) return;
    const lines = activeContentInput.value.split("\n");
    const count = lines.length || 1;
    let nums = "";
    for (let i = 1; i <= count; i++) {
        nums += i + "\n";
    }
    lineNumbersGutter.textContent = nums;
}

function getEditorContent() {
    return activeContentInput ? activeContentInput.value : "";
}

function setEditorContent(content) {
    if (!activeContentInput) return;
    activeContentInput.value = content || "";
    updateLineNumbers();
    updateEditorStats(content || "");
}

function detectAndApplyLanguage(content) {
    if (!content || !content.trim()) {
        currentDetectedLang = "plaintext";
        if (languageBadge) languageBadge.textContent = "TEXT";
        return "plaintext";
    }

    const trimmed = content.trim();
    let detected = null;

    if (
        (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
        (trimmed.startsWith("[") && trimmed.endsWith("]"))
    ) {
        try {
            JSON.parse(trimmed);
            detected = "json";
        } catch {
            // niepoprawny json
        }
    }

    if (!detected) {
        if (
            /^<!DOCTYPE html>/i.test(trimmed) ||
            /<html[\s>]/i.test(trimmed) ||
            /<(div|span|p|a|ul|ol|li|table|head|body|script|link|meta)[\s>]/i.test(trimmed)
        ) {
            detected = "html";
        }
    }

    if (!detected) {
        if (
            /(@import|@media|@keyframes|:root)\s*[\{\(]/i.test(trimmed) ||
            (/([.#]?[a-z0-9_\-:\s,]+)\s*\{[\s\S]*?:[\s\S]*?\}/i.test(trimmed) && !trimmed.includes("function"))
        ) {
            detected = "css";
        }
    }

    if (!detected) {
        if (
            /(const|let|var)\s+[a-zA-Z0-9_$]+\s*=/i.test(trimmed) ||
            /function\s*[a-zA-Z0-9_$]*\s*\(/i.test(trimmed) ||
            /=>\s*\{/i.test(trimmed) ||
            /console\.(log|warn|error)\(/i.test(trimmed)
        ) {
            detected = "javascript";
        }
    }

    if (!detected) {
        if (
            /^#{1,6}\s+\S+/m.test(trimmed) ||
            /```[\s\S]*?```/m.test(trimmed) ||
            /^\s*[\*\-]\s+\S+/m.test(trimmed) ||
            /^\s*\d+\.\s+\S+/m.test(trimmed) ||
            /\[.+?\]\(https?:\/\/.+?\)/.test(trimmed) ||
            /^>\s+\S+/m.test(trimmed)
        ) {
            detected = "markdown";
        }
    }

    currentDetectedLang = detected || "plaintext";
    if (languageBadge) {
        languageBadge.textContent = currentDetectedLang === "plaintext" ? "TEXT" : currentDetectedLang.toUpperCase();
    }
    return currentDetectedLang;
}

function handleEditorContentChange() {
    if (!selectedNoteId) return;
    const note = notes.find((n) => n.id === selectedNoteId);
    if (!note) return;

    const content = getEditorContent();
    note.content = content;

    updateLineNumbers();
    updateEditorStats(content);
    detectAndApplyLanguage(content);

    if (currentViewMode === "split" || currentViewMode === "preview") {
        renderActivePreview();
    }

    saveStatusIndicator.textContent = `ZAPISANO (${new Date().toLocaleTimeString()})`;
    saveNotesToLocalStorage();
    renderNotesList();
}

function buildFastNoteExportArray() {
    return notes.map((n) => ({
        id: n.id,
        data: n.date,
        note: JSON.stringify({
            title: n.title,
            content: n.content
        })
    }));
}

function normalizeRawNotes(rawArray) {
    if (!Array.isArray(rawArray)) {
        if (typeof rawArray === "object" && rawArray !== null) {
            rawArray = [rawArray];
        } else {
            throw new Error("Dane nie są poprawną tablicą JSON!");
        }
    }

    return rawArray.map((item) => {
        const id = item.id || (crypto.randomUUID ? crypto.randomUUID() : "note_" + Date.now() + "_" + Math.random().toString(36).substr(2, 9));
        const date = item.data || item.date || new Date().toISOString();
        let title = "Bez tytułu";
        let content = "";

        if (typeof item.note === "string") {
            try {
                const parsed = JSON.parse(item.note);
                title = parsed.title || title;
                content = parsed.content || "";
            } catch {
                content = item.note;
            }
        } else if (typeof item.note === "object" && item.note !== null) {
            title = item.note.title || title;
            content = item.note.content || "";
        } else {
            title = item.title || title;
            content = item.content || "";
        }

        return { id, date, title, content };
    });
}

function formatDate(isoStr) {
    if (!isoStr) return "-";
    try {
        return new Date(isoStr).toLocaleDateString("pl-PL", {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit"
        });
    } catch {
        return isoStr;
    }
}

function escapeHtml(str) {
    return String(str || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function toggleSidebar(forcedState = null) {
    isSidebarCollapsed = forcedState !== null ? forcedState : !isSidebarCollapsed;
    if (appAside) {
        appAside.classList.toggle("collapsed", isSidebarCollapsed);
    }
    const backdrop = document.getElementById("sidebarBackdrop");
    if (backdrop) {
        const isMobile = window.innerWidth <= 768;
        backdrop.classList.toggle("hidden", isSidebarCollapsed || !isMobile);
    }
    if (toggleSidebarBtn) {
        toggleSidebarBtn.closest(".btn-bg")?.classList.toggle("active", !isSidebarCollapsed);
    }
}

function setViewMode(mode) {
    currentViewMode = mode;
    localStorage.setItem("fastnote_view_mode", mode);

    if (editorWorkspace) {
        editorWorkspace.className = `editor-workspace mode-${mode}`;
    }

    modeEditBtn?.classList.toggle("active", mode === "edit");
    modeSplitBtn?.classList.toggle("active", mode === "split");
    modePreviewBtn?.classList.toggle("active", mode === "preview");

    if (mode === "split" || mode === "preview") {
        renderActivePreview();
    }
}

function updateEditorStats(content) {
    const text = content || "";
    const chars = text.length;
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    const lines = text ? text.split("\n").length : 1;
    const readingMinutes = Math.max(1, Math.ceil(words / 200));

    if (charCountLabel) charCountLabel.textContent = `${chars} ZNAKÓW`;
    if (wordCountLabel) wordCountLabel.textContent = `${words} SŁÓW`;
    if (lineCountLabel) lineCountLabel.textContent = `${lines} ${lines === 1 ? "LINIA" : "LINII"}`;
    if (readingTimeLabel) readingTimeLabel.textContent = `< ${readingMinutes} MIN`;
}

function renderPlainTextView(text) {
    const lines = text.split("\n");
    const lineCount = lines.length;
    const byteCount = new TextEncoder().encode(text).length;

    let linesHtml = "";
    lines.forEach((rawLine, index) => {
        const lineNum = index + 1;
        let formatted = escapeHtml(rawLine);

        formatted = formatted.replace(
            /(https?:\/\/[^\s<]+)/g,
            '<a href="$1" target="_blank" rel="noopener noreferrer" class="plain-url">$1 ↗</a>'
        );

        formatted = formatted.replace(/\[(OK\vert{}SUCCESS\vert{}PASS\vert{}200)\]/gi, '<span class="plain-tag plain-tag-ok">[$1]</span>');
        formatted = formatted.replace(/\[(WARN\vert{}WARNING\vert{}WAIT)\]/gi, '<span class="plain-tag plain-tag-warn">[$1]</span>');
        formatted = formatted.replace(/\[(ERR\vert{}ERROR\vert{}FAIL\vert{}404\vert{}500)\]/gi, '<span class="plain-tag plain-tag-err">[$1]</span>');
        formatted = formatted.replace(/\[(INFO\vert{}DEBUG\vert{}SYS\vert{}SEC)\]/gi, '<span class="plain-tag plain-tag-info">[$1]</span>');

        formatted = formatted.replace(
            /^([A-Za-z0-9_\-\.\/]+)(:)(\s+)(.*)$/,
            '<span class="plain-key">$1</span><span class="plain-colon">:</span>$3<span class="plain-val">$4</span>'
        );

        linesHtml += `
      <div class="plain-line">
        <span class="plain-num">${lineNum}</span>
        <span class="plain-text">${formatted || "&nbsp;"}</span>
      </div>
    `;
    });

    return `
    <div class="plain-hud-viewer">
      <div class="plain-hud-header">
        <span class="plain-hud-label">// DOKUMENT TEKSTOWY [RAW_READOUT]</span>
        <div class="plain-hud-meta">
          <span>LINIE: ${lineCount}</span>
          <span>ROZMIAR: ${byteCount} B</span>
          <button type="button" class="plain-copy-btn" id="plainTextCopyBtn">KOPIUJ CAŁOŚĆ</button>
        </div>
      </div>
      <div class="plain-lines-container">
        ${linesHtml}
      </div>
    </div>
  `;
}

function parseAndRenderContent(text) {
    if (!text || !text.trim()) {
        return '<div class="preview-empty-hint">// PUSTA ZAWARTOŚĆ DOKUMENTU</div>';
    }

    if (currentDetectedLang === "html") {
        return text;
    }

    if (currentDetectedLang === "plaintext") {
        return renderPlainTextView(text);
    }

    if (currentDetectedLang === "json") {
        try {
            const parsedObj = JSON.parse(text);
            const prettyJson = escapeHtml(JSON.stringify(parsedObj, null, 2));
            return `
        <div class="code-block-container">
          <div class="code-block-header">
            <span>// ZWALIDOWANA STRUKTURA JSON</span>
            <button type="button" class="code-copy-btn">KOPIUJ JSON</button>
          </div>
          <pre><code>${prettyJson}</code></pre>
        </div>
      `;
        } catch {
            return renderPlainTextView(text);
        }
    }

    let raw = text;
    const codeBlocks = [];

    raw = raw.replace(/```([a-zA-Z0-9_\-\.\/]*)\n([\s\S]*?)```/g, (match, lang, code) => {
        const placeholder = `__CODE_BLOCK_PLACEHOLDER_${codeBlocks.length}__`;
        const cleanLang = (lang || "KOD").trim().toUpperCase();
        const escapedCode = escapeHtml(code.trimEnd());
        codeBlocks.push(
            `<div class="code-block-container">` +
            `<div class="code-block-header"><span>// ${cleanLang}</span><button type="button" class="code-copy-btn">KOPIUJ</button></div>` +
            `<pre><code>${escapedCode}</code></pre>` +
            `</div>`
        );
        return placeholder;
    });

    raw = raw.replace(/^#### (.*$)/gim, "<h4>$1</h4>");
    raw = raw.replace(/^### (.*$)/gim, "<h3>$1</h3>");
    raw = raw.replace(/^## (.*$)/gim, "<h2>$1</h2>");
    raw = raw.replace(/^# (.*$)/gim, "<h1>$1</h1>");

    raw = raw.replace(/^\> (.*$)/gim, "<blockquote>$1</blockquote>");
    raw = raw.replace(/^(?:---|\*\*\*|___)$/gim, '<hr class="hud-hr">');

    raw = raw.replace(/`([^`\n]+)`/g, '<code class="inline-code">$1</code>');
    raw = raw.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    raw = raw.replace(/\*([^*]+)\*/g, "<em>$1</em>");

    raw = raw.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1 ↗</a>');
    raw = raw.replace(/(^|[^"'])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2 ↗</a>');

    raw = raw.replace(/^[\*\-] (.*$)/gim, "<li>$1</li>");
    raw = raw.replace(/^\d+\. (.*$)/gim, "<li>$1</li>");
    raw = raw.replace(/(<li>(?:(?!<\/li>).)*<\/li>)+/gs, "<ul>$&</ul>");

    const segments = raw.split(/\n\n+/);
    let html = segments
        .map((seg) => {
            const trimmed = seg.trim();
            if (!trimmed) return "";
            if (
                trimmed.startsWith("<h") ||
                trimmed.startsWith("<div") ||
                trimmed.startsWith("<ul") ||
                trimmed.startsWith("<ol") ||
                trimmed.startsWith("<blockquote") ||
                trimmed.startsWith("<hr") ||
                trimmed.startsWith("__CODE_BLOCK_PLACEHOLDER_")
            ) {
                return trimmed;
            }
            return `<p>${trimmed.replace(/\n/g, "<br>")}</p>`;
        })
        .join("");

    codeBlocks.forEach((block, idx) => {
        html = html.replace(`__CODE_BLOCK_PLACEHOLDER_${idx}__`, block);
    });

    return html;
}

function renderActivePreview() {
    if (!previewIframe) return;
    const content = getEditorContent();
    const parsedBody = parseAndRenderContent(content);
    const currentTheme = root.getAttribute("theme") || "dark";

    const isolatedDocument = `
    <!DOCTYPE html>
    <html lang="pl" theme="${currentTheme}">
    <head>
      <meta charset="UTF-8">
      <link rel="preconnect" href="https://fonts.googleapis.com">
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
      <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
      <style>
        *, *::before, *::after { border-radius: 0 !important; box-sizing: border-box; }
        :root {
          --oi-bg: ${currentTheme === 'dark' ? '#1e1e1e' : '#ffffff'};
          --oi-fg: ${currentTheme === 'dark' ? '#e0e0e0' : '#212529'};
          --oi-border: ${currentTheme === 'dark' ? '#2a2a2a' : '#dee2e6'};
          --oi-card: ${currentTheme === 'dark' ? '#252526' : '#f0f0f0'};
          --oi-tertiary: ${currentTheme === 'dark' ? '#2e2e2e' : '#fafafa'};
          --oi-highlight: #f36c00;
          --oi-muted: ${currentTheme === 'dark' ? '#858585' : '#6c757d'};
          --oi-success: #28a745;
          --oi-warning: #ffc107;
          --oi-danger: #dc3545;
          --oi-info: #17a2b8;
          --oi-link: #3b82f6;
        }
        body {
          margin: 0;
          padding: 12px 14px;
          background-color: var(--oi-bg);
          color: var(--oi-fg);
          font-family: 'JetBrains Mono', monospace;
          font-size: 12.5px;
          line-height: 1.6;
          word-break: break-word;
        }
        h1, h2, h3, h4 {
          color: var(--oi-highlight);
          margin: 0.9rem 0 0.45rem 0;
          line-height: 1.25;
          font-weight: 700;
          border-bottom: 1px dashed var(--oi-border);
          padding-bottom: 0.25rem;
        }
        h1:first-child, h2:first-child { margin-top: 0; }
        p { margin: 0 0 0.65rem 0; }
        ul, ol { margin: 0 0 0.75rem 0; padding-left: 1.4rem; }
        li { margin-bottom: 0.25rem; }
        blockquote {
          margin: 0.6rem 0;
          padding: 0.4rem 0.75rem;
          background: var(--oi-tertiary);
          border-left: 3px solid var(--oi-highlight);
          color: var(--oi-muted);
        }
        code.inline-code {
          background: var(--oi-card);
          border: 1px solid var(--oi-border);
          padding: 1px 4px;
          font-size: 0.85em;
          color: var(--oi-highlight);
        }
        .code-block-container {
          margin: 0.65rem 0;
          border: 1px solid var(--oi-border);
          background: var(--oi-tertiary);
        }
        .code-block-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0.25rem 0.5rem;
          background: var(--oi-card);
          border-bottom: 1px solid var(--oi-border);
          font-size: 10px;
          color: var(--oi-muted);
          font-weight: 700;
        }
        .code-copy-btn, .plain-copy-btn {
          background: transparent;
          border: 1px solid var(--oi-border);
          color: var(--oi-muted);
          font-family: inherit;
          font-size: 9.5px;
          padding: 2px 6px;
          cursor: pointer;
          text-transform: uppercase;
        }
        .code-copy-btn:hover, .plain-copy-btn:hover {
          color: var(--oi-highlight);
          border-color: var(--oi-highlight);
        }
        pre {
          margin: 0;
          padding: 0.65rem;
          overflow-x: auto;
          font-family: inherit;
          font-size: 12px;
          line-height: 1.45;
          color: var(--oi-fg);
        }
        hr.hud-hr {
          border: none;
          border-top: 1px dashed var(--oi-border);
          margin: 0.85rem 0;
        }
        a {
          color: var(--oi-link);
          text-decoration: underline;
        }
        a:hover {
          color: var(--oi-highlight);
        }
        .preview-empty-hint {
          color: var(--oi-muted);
          font-style: italic;
          padding: 1rem 0;
          text-align: center;
        }
        .plain-hud-viewer {
          display: flex;
          flex-direction: column;
          border: 1px solid var(--oi-border);
        }
        .plain-hud-header {
          display: flex;
          justify-content: space-between;
          padding: 0.35rem 0.6rem;
          background: var(--oi-card);
          border-bottom: 1px solid var(--oi-border);
          font-size: 10px;
          font-weight: 700;
          color: var(--oi-highlight);
        }
        .plain-hud-meta {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          color: var(--oi-muted);
          font-size: 9.5px;
        }
        .plain-lines-container {
          padding: 0.4rem 0;
          overflow-x: auto;
        }
        .plain-line {
          display: flex;
          align-items: baseline;
          min-height: 19px;
          padding: 0 0.5rem;
        }
        .plain-line:hover {
          background: var(--oi-tertiary);
        }
        .plain-num {
          width: 38px;
          flex-shrink: 0;
          color: var(--oi-muted);
          font-size: 10px;
          text-align: right;
          padding-right: 0.75rem;
          border-right: 1px solid var(--oi-border);
          user-select: none;
          opacity: 0.75;
        }
        .plain-text {
          flex: 1 1 0;
          padding-left: 0.75rem;
          font-size: 12px;
          white-space: pre-wrap;
          word-break: break-word;
        }
        .plain-tag-ok { color: var(--oi-success); font-weight: 700; }
        .plain-tag-warn { color: var(--oi-warning); font-weight: 700; }
        .plain-tag-err { color: var(--oi-danger); font-weight: 700; }
        .plain-tag-info { color: var(--oi-info); font-weight: 700; }
        .plain-key { color: var(--oi-highlight); font-weight: 700; }
        .plain-colon { color: var(--oi-muted); margin-right: 0.2rem; }
      </style>
    </head>
    <body>
      ${parsedBody}
      <script>
        document.querySelectorAll('.code-copy-btn, .plain-copy-btn').forEach(btn => {
          btn.addEventListener('click', (e) => {
            const target = e.currentTarget;
            let text = '';
            if (target.classList.contains('plain-copy-btn')) {
              text = document.querySelector('.plain-lines-container')?.innerText || '';
            } else {
              text = target.closest('.code-block-container')?.querySelector('code')?.innerText || '';
            }
            if (text && navigator.clipboard) {
              navigator.clipboard.writeText(text);
              const orig = target.innerText;
              target.innerText = 'SKOPIOWANO';
              setTimeout(() => target.innerText = orig, 1500);
            }
          });
        });
      <\/script>
    </body>
    </html>
  `;

    previewIframe.srcdoc = isolatedDocument;
}

function saveNotesToLocalStorage() {
    try {
        localStorage.setItem("fastnote_notes_cache", JSON.stringify(buildFastNoteExportArray()));
        if (selectedNoteId) {
            localStorage.setItem("fastnote_active_note_id", selectedNoteId);
        }
    } catch {
        // brak dostępu do LocalStorage
    }
}

function renderNotesList() {
    notesListContainer.innerHTML = "";

    const q = searchQuery.toLowerCase().trim();
    const filtered = notes.filter((n) => {
        if (!q) return true;
        return (
            (n.title && n.title.toLowerCase().includes(q)) ||
            (n.content && n.content.toLowerCase().includes(q)) ||
            (n.id && n.id.toLowerCase().includes(q))
        );
    });

    filteredCountText.textContent = `${filtered.length} / ${notes.length}`;

    if (filtered.length === 0) {
        notesListContainer.innerHTML =
            '<div style="text-align: center; padding: 1.5rem; color: var(--oi-color-31); font-size: 0.7rem;">[ BRAK WYNIKÓW W BAZIE ]</div>';
        return;
    }

    filtered.forEach((note) => {
        const isSelected = note.id === selectedNoteId;

        const cassette = document.createElement("div");
        cassette.className = `btn-bg w-full ${isSelected ? "active" : ""}`;

        const btn = document.createElement("button");
        btn.className = "note-item";

        const snippet = (note.content || "Brak zawartości")
            .replace(/<[^>]*>?/gm, " ")
            .slice(0, 95)
            .trim();

        btn.innerHTML = `
      <div class="note-item-header">
        <span class="note-item-title">${escapeHtml(note.title || "Bez tytułu")}</span>
        <span class="note-item-date">${formatDate(note.date).split(",")[0]}</span>
      </div>
      <div class="note-item-snippet">${escapeHtml(snippet || "(pusta treść)")}</div>
      <div class="note-item-footer">
        <span>#${note.id.substring(0, 8)}</span>
        <span>${(note.content || "").length} B</span>
      </div>
    `;

        btn.addEventListener("click", () => selectNote(note.id));
        cassette.appendChild(btn);
        notesListContainer.appendChild(cassette);
    });
}

function selectNote(id) {
    selectedNoteId = id;
    const note = notes.find((n) => n.id === id);

    if (!note) {
        emptyDetailPlaceholder.classList.remove("hidden");
        activeNoteContainer.classList.add("hidden");
        renderNotesList();
        return;
    }

    emptyDetailPlaceholder.classList.add("hidden");
    activeNoteContainer.classList.remove("hidden");

    activeNoteId.textContent = note.id;
    activeNoteDate.textContent = formatDate(note.date);
    activeTitleInput.value = note.title || "";

    setEditorContent(note.content || "");
    detectAndApplyLanguage(note.content || "");
    renderActivePreview();
    renderNotesList();
    saveNotesToLocalStorage();

    if (window.innerWidth <= 768) {
        toggleSidebar(true);
    }

    if (window.lucide) lucide.createIcons();
}

function updateActiveTitle() {
    if (!selectedNoteId) return;
    const note = notes.find((n) => n.id === selectedNoteId);
    if (!note) return;

    note.title = activeTitleInput.value;
    saveStatusIndicator.textContent = `ZAPISANO (${new Date().toLocaleTimeString()})`;
    saveNotesToLocalStorage();
    renderNotesList();
}

async function pullFromGithub() {
    const { repo, branch, path, token, rawUrl, useCorsProxy } = githubConfig;
    const cleanBranch = cleanBranchName(branch);
    const cleanRepo = (repo || "")
        .trim()
        .replace(/^https?:\/\/github\.com\//, "")
        .replace(/\/$/, "");
    const cleanPath = (path || "s-note.json").trim().replace(/^\//, "");

    if (!cleanRepo) {
        showToast("Skonfiguruj repozytorium (⚙️)!", "error");
        openModal("githubModal");
        return;
    }

    addDiagLog(`Pobieranie: ${cleanRepo}:${cleanBranch}/${cleanPath}`);
    let loadedData = null;
    let loadedSha = null;

    try {
        const apiUrl = `https://api.github.com/repos/${cleanRepo}/contents/${cleanPath}?ref=${encodeURIComponent(
            cleanBranch
        )}&t=${Date.now()}`;
        const res = await fetch(apiUrl, {
            headers: {
                Accept: "application/vnd.github.v3+json",
                ...getAuthHeaders(token)
            }
        });

        if (res.ok) {
            const data = await res.json();
            if (data.content) {
                loadedData = JSON.parse(base64ToUtf8(data.content));
                loadedSha = data.sha;
                addDiagLog(`Contents API: pobrano SHA ${data.sha.slice(0, 7)}`, "ok");
            }
        } else {
            addDiagLog(`Contents API status: ${res.status}`, "warn");
        }
    } catch (err) {
        addDiagLog(`Błąd Contents API: ${err.message}`, "error");
    }

    if (!loadedData) {
        const urls = [
            rawUrl,
            `https://raw.githubusercontent.com/${cleanRepo}/${encodeURIComponent(cleanBranch)}/${cleanPath}`
        ].filter(Boolean);

        for (const url of urls) {
            try {
                const noCache = `${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}`;
                const target = useCorsProxy
                    ? `https://api.allorigins.win/raw?url=${encodeURIComponent(noCache)}`
                    : noCache;
                const res = await fetch(target);
                if (res.ok) {
                    loadedData = await res.json();
                    addDiagLog(`Załadowano przez RAW URL`, "ok");
                    break;
                }
            } catch (e) {
                addDiagLog(`Błąd RAW URL: ${e.message}`, "warn");
            }
        }
    }

    if (loadedData) {
        applyLoadedData(loadedData, loadedSha);
        showToast(`Pobrano ${notes.length} notatek!`, "success");
    } else {
        showToast("Błąd pobierania bazy notatek", "error");
        openModal("diagModal");
    }
}

/**
 * Wysyła aktualny stan notatek do GitHub (wywoływane ręcznie lub po usunięciu notatki)
 */
async function pushToGithub(customMessage = null) {
    const { repo, branch, path, token } = githubConfig;
    const cleanBranch = cleanBranchName(branch);
    const message =
        customMessage ||
        document.getElementById("commitMessageInput").value.trim() ||
        "Aktualizacja bazy notatek";
    const errorBox = document.getElementById("commitErrorBox");
    if (errorBox) errorBox.classList.add("hidden");

    try {
        addDiagLog(`Commit do ${repo}:${cleanBranch}/${path}...`);

        let fileSha = currentFileSha;
        const checkUrl = `https://api.github.com/repos/${repo}/contents/${path}?ref=${encodeURIComponent(
            cleanBranch
        )}&t=${Date.now()}`;
        const checkResp = await fetch(checkUrl, {
            headers: {
                Accept: "application/vnd.github.v3+json",
                ...getAuthHeaders(token)
            }
        });

        if (checkResp.ok) {
            const checkData = await checkResp.json();
            fileSha = checkData.sha;
        }

        const payload = {
            message,
            content: utf8ToBase64(JSON.stringify(buildFastNoteExportArray(), null, 2)),
            branch: cleanBranch
        };
        if (fileSha) payload.sha = fileSha;

        const putRes = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
            method: "PUT",
            headers: {
                Accept: "application/vnd.github.v3+json",
                "Content-Type": "application/json",
                ...getAuthHeaders(token)
            },
            body: JSON.stringify(payload)
        });

        const result = await putRes.json();
        if (!putRes.ok) throw new Error(result.message || `Status HTTP ${putRes.status}`);

        currentFileSha = result.content?.sha || null;
        if (currentFileSha && fileShaBadge) fileShaBadge.textContent = `SHA: ${currentFileSha.slice(0, 7)}`;

        closeAllModals();
        addDiagLog(`Commit sukces: SHA ${currentFileSha}`, "ok");
        showToast("Wysłano commit do repozytorium!", "success");
        return true;
    } catch (err) {
        addDiagLog(`Błąd PUSH: ${err.message}`, "error");
        if (errorBox) {
            errorBox.textContent = `[BŁĄD]: ${err.message}`;
            errorBox.classList.remove("hidden");
        }
        showToast(`Błąd zapisu do GitHub: ${err.message}`, "error");
        return false;
    }
}

function applyLoadedData(parsed, sha) {
    if (sha) {
        currentFileSha = sha;
        fileShaBadge.textContent = `SHA: ${sha.slice(0, 7)}`;
    }
    notes = normalizeRawNotes(parsed);
    selectedNoteId = notes.length > 0 ? notes[0].id : null;
    selectNote(selectedNoteId);
    saveNotesToLocalStorage();
    repoStatusIndicator.textContent = `${githubConfig.repo}:${cleanBranchName(
        githubConfig.branch
    )} (${notes.length})`;
}

function openModal(id) {
    const modal = document.getElementById(id);
    const overlay = document.getElementById(`${id}Overlay`);
    if (modal && overlay) {
        modal.classList.add("active");
        overlay.classList.add("active");
    }
}

function closeAllModals() {
    document.querySelectorAll(".modal, .modal-overlay").forEach((el) => el.classList.remove("active"));
}

// Zdarzenia pól i edytora
activeTitleInput.addEventListener("input", updateActiveTitle);

activeContentInput.addEventListener("keydown", (e) => {
    if (e.key === "Tab") {
        e.preventDefault();
        const start = activeContentInput.selectionStart;
        const end = activeContentInput.selectionEnd;
        const val = activeContentInput.value;
        activeContentInput.value = val.substring(0, start) + "  " + val.substring(end);
        activeContentInput.selectionStart = activeContentInput.selectionEnd = start + 2;
        handleEditorContentChange();
    }
});

activeContentInput.addEventListener("input", handleEditorContentChange);

activeContentInput.addEventListener("scroll", () => {
    if (lineNumbersGutter) {
        lineNumbersGutter.scrollTop = activeContentInput.scrollTop;
    }
});

toggleSidebarBtn?.addEventListener("click", () => toggleSidebar());
document.getElementById("sidebarBackdrop")?.addEventListener("click", () => toggleSidebar(true));

modeEditBtn?.addEventListener("click", () => setViewMode("edit"));
modeSplitBtn?.addEventListener("click", () => setViewMode("split"));
modePreviewBtn?.addEventListener("click", () => setViewMode("preview"));

document.getElementById("saveNoteExplicitBtn").addEventListener("click", () => {
    handleEditorContentChange();
    showToast("Zapisano dokument lokalnie", "success");
});

document.getElementById("addNoteBtn").addEventListener("click", () => {
    const newNote = {
        id: crypto.randomUUID ? crypto.randomUUID() : "note_" + Date.now(),
        date: new Date().toISOString(),
        title: "NOWY_DOKUMENT",
        content: "Treść nowej notatki..."
    };
    notes.unshift(newNote);
    saveNotesToLocalStorage();
    selectNote(newNote.id);
    activeTitleInput.focus();
    showToast("Utworzono nową notatkę", "info");
});

// Otwieranie sprzętowego okna potwierdzenia usunięcia w stylu HUD
document.getElementById("deleteNoteBtn").addEventListener("click", () => {
    if (!selectedNoteId) return;
    const note = notes.find((n) => n.id === selectedNoteId);
    if (!note) return;

    notePendingDeletion = { ...note };
    deleteConfirmTitle.textContent = note.title || "Bez tytułu";
    deleteConfirmId.textContent = note.id;

    openModal("deleteConfirmModal");
});

// Potwierdzenie usunięcia i natychmiastowy Push do GitHub
executeDeleteAndPushBtn.addEventListener("click", async () => {
    if (!notePendingDeletion) return;
    const deletedTitle = notePendingDeletion.title || "Bez tytułu";
    const deletedId = notePendingDeletion.id;

    // 1. Usunięcie lokalne
    notes = notes.filter((n) => n.id !== deletedId);
    selectedNoteId = notes.length > 0 ? notes[0].id : null;
    saveNotesToLocalStorage();
    selectNote(selectedNoteId);
    closeAllModals();

    showToast(`Usunięto rekord "${deletedTitle}" lokalnie`, "info");

    // 2. Automatyczny commit i push do GitHub
    if (githubConfig.token) {
        showToast("Synchronizacja usunięcia z GitHub...", "info");
        await pushToGithub(`Usunięto rekord: ${deletedTitle} [FastNote HUD]`);
    } else {
        showToast("Skonfiguruj token PAT, aby zsynchronizować usunięcie z GitHub", "warn");
    }

    notePendingDeletion = null;
});

document.getElementById("copyContentBtn").addEventListener("click", () => {
    const content = getEditorContent();
    navigator.clipboard.writeText(content).then(
        () => showToast("Skopiowano do schowka", "success"),
        () => showToast("Błąd kopiowania", "error")
    );
});

searchInput.addEventListener("input", (e) => {
    searchQuery = e.target.value;
    if (clearSearchBtn) {
        clearSearchBtn.classList.toggle("hidden", !searchQuery.trim());
    }
    renderNotesList();
});

clearSearchBtn?.addEventListener("click", () => {
    searchInput.value = "";
    searchQuery = "";
    clearSearchBtn.classList.add("hidden");
    renderNotesList();
    searchInput.focus();
});

// Wczytywanie z pliku i Eksport
document.getElementById("fileUploadInput").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
        try {
            const parsed = JSON.parse(evt.target.result);
            applyLoadedData(parsed, null);
            showToast(`Załadowano ${notes.length} notatek z pliku`, "success");
        } catch (err) {
            showToast("Błąd parsowania: " + err.message, "error");
        }
    };
    reader.readAsText(file);
    e.target.value = "";
});

document.getElementById("exportJsonBtn").addEventListener("click", () => {
    const data = JSON.stringify(buildFastNoteExportArray(), null, 2);
    const blob = new Blob([data], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "s-note.json";
    a.click();
    URL.revokeObjectURL(url);
    showToast("Wyeksportowano s-note.json", "success");
});

// Import surowego kodu JSON
document.getElementById("openRawModalBtn").addEventListener("click", () => {
    document.getElementById("rawJsonTextarea").value = "";
    document.getElementById("modalParseError").classList.add("hidden");
    openModal("rawModal");
});

document.getElementById("submitRawJsonBtn").addEventListener("click", () => {
    const text = document.getElementById("rawJsonTextarea").value.trim();
    const errorBox = document.getElementById("modalParseError");
    try {
        const parsed = JSON.parse(text);
        applyLoadedData(parsed, null);
        closeAllModals();
        showToast(`Załadowano ${notes.length} notatek`, "success");
    } catch (err) {
        errorBox.textContent = `BŁĄD: ${err.message}`;
        errorBox.classList.remove("hidden");
    }
});

// Zdarzenia GitHub API & Pobieranie tokena z auth.json
document.getElementById("loadAuthPatBtn")?.addEventListener("click", () => {
    loadNoteManagerToken(false);
});

document.getElementById("pullGithubBtn").addEventListener("click", pullFromGithub);

document.getElementById("pushGithubBtn").addEventListener("click", () => {
    if (!githubConfig.token) {
        showToast("Wymagany GitHub PAT!", "error");
        openModal("githubModal");
        return;
    }
    document.getElementById("commitTargetRepo").textContent = githubConfig.repo;
    document.getElementById("commitTargetBranch").textContent = cleanBranchName(githubConfig.branch);
    document.getElementById("commitTargetPath").textContent = githubConfig.path;
    openModal("commitModal");
});

document.getElementById("executePushBtn").addEventListener("click", () => pushToGithub());

document.getElementById("openGithubConfigBtn").addEventListener("click", () => {
    document.getElementById("ghRepoInput").value = githubConfig.repo;
    document.getElementById("ghBranchInput").value = cleanBranchName(githubConfig.branch);
    document.getElementById("ghPathInput").value = githubConfig.path;
    document.getElementById("ghTokenInput").value = githubConfig.token;
    document.getElementById("ghRawUrlInput").value = githubConfig.rawUrl;
    document.getElementById("useCorsProxyToggle").checked = Boolean(githubConfig.useCorsProxy);
    ghModalStatus.classList.add("hidden");

    // Jeśli brak tokena, zaproponuj automatyczne odszyfrowanie z auth.json
    if (!githubConfig.token) {
        loadNoteManagerToken(true);
    }

    openModal("githubModal");
});

document.getElementById("saveGithubConfigBtn").addEventListener("click", () => {
    githubConfig.repo = document.getElementById("ghRepoInput").value.trim();
    githubConfig.branch = cleanBranchName(document.getElementById("ghBranchInput").value.trim());
    githubConfig.path = document.getElementById("ghPathInput").value.trim();
    githubConfig.token = document.getElementById("ghTokenInput").value.trim();
    githubConfig.rawUrl = document.getElementById("ghRawUrlInput").value.trim();
    githubConfig.useCorsProxy = document.getElementById("useCorsProxyToggle").checked;

    localStorage.setItem("fastnote_gh_config", JSON.stringify(githubConfig));
    repoStatusIndicator.textContent = `${githubConfig.repo}:${cleanBranchName(githubConfig.branch)}`;
    closeAllModals();
    showToast("Zapisano konfigurację", "info");
});

document.getElementById("testConnectionBtn").addEventListener("click", async () => {
    const repo = document.getElementById("ghRepoInput").value.trim();
    const branch = cleanBranchName(document.getElementById("ghBranchInput").value.trim());
    const path = document.getElementById("ghPathInput").value.trim();
    const token = document.getElementById("ghTokenInput").value.trim();

    ghModalStatus.classList.remove("hidden");
    ghModalStatus.textContent = "[SYSTEM]: Testowanie...";

    try {
        const res = await fetch(
            `https://api.github.com/repos/${repo}/contents/${path}?ref=${encodeURIComponent(
                branch
            )}&t=${Date.now()}`,
            { headers: { Accept: "application/vnd.github.v3+json", ...getAuthHeaders(token) } }
        );
        if (res.ok) {
            const data = await res.json();
            currentFileSha = data.sha;
            fileShaBadge.textContent = `SHA: ${data.sha.slice(0, 7)}`;
            ghModalStatus.textContent = `[POŁĄCZONO]: 200 OK\nSHA: ${data.sha}\nRozmiar: ${data.size} B`;
        } else {
            ghModalStatus.textContent = `[BŁĄD]: HTTP ${res.status}`;
        }
    } catch (err) {
        ghModalStatus.textContent = `[BŁĄD SIECI]: ${err.message}`;
    }
});

document.getElementById("openDiagBtn").addEventListener("click", () => {
    openModal("diagModal");
    renderDiagLogs();
});

const copyDiagBtn = document.getElementById("copyDiagBtn");
if (copyDiagBtn) {
    copyDiagBtn.addEventListener("click", async () => {
        if (!diagLogs.length) {
            showToast("Dziennik diagnostyczny jest pusty.", "warning");
            return;
        }
        const fullText = diagLogs.map(l => l.text || `[${l.time}] [${(l.level || 'INFO').toUpperCase()}] ${l.msg}`).join("\n");
        await navigator.clipboard.writeText(fullText);
        showToast("Skopiowano dziennik do schowka!", "success");
    });
}

document.getElementById("clearDiagBtn").addEventListener("click", () => {
    diagLogs.length = 0;
    renderDiagLogs();
    showToast("Wyczyszczono dziennik diagnostyczny.", "info");
});

document.querySelectorAll(".modal-close-btn, .modal-overlay").forEach((el) => {
    el.addEventListener("click", closeAllModals);
});

// Przełącznik motywu
themeToggleBtn.addEventListener("click", () => {
    const isDark = root.getAttribute("theme") === "dark";
    const newTheme = isDark ? "light" : "dark";
    root.setAttribute("theme", newTheme);
    localStorage.setItem("fastnote_theme", newTheme);

    themeToggleBtn.innerHTML = `<i data-lucide="${isDark ? 'moon' : 'sun'}"></i>`;
    lucide.createIcons();

    renderActivePreview();
});

// Skróty klawiszowe
window.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        handleEditorContentChange();
        showToast("Zapisano dokument (Ctrl+S)", "success");
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        toggleSidebar();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "1") {
        e.preventDefault();
        setViewMode("edit");
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "2") {
        e.preventDefault();
        setViewMode("split");
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "3") {
        e.preventDefault();
        setViewMode("preview");
    }
});

// Inicjalizacja Aplikacji
window.addEventListener("DOMContentLoaded", () => {
    try {
        const savedTheme = localStorage.getItem("fastnote_theme") || "dark";
        root.setAttribute("theme", savedTheme);
        themeToggleBtn.innerHTML = `<i data-lucide="${savedTheme === 'dark' ? 'sun' : 'moon'}"></i>`;

        const savedMode = localStorage.getItem("fastnote_view_mode") || "split";
        const cached = localStorage.getItem("fastnote_notes_cache");
        const cachedActiveId = localStorage.getItem("fastnote_active_note_id");

        if (cached) {
            try {
                notes = normalizeRawNotes(JSON.parse(cached));
            } catch {
                notes = normalizeRawNotes(initialNotesData);
            }
        } else {
            notes = normalizeRawNotes(initialNotesData);
        }

        setViewMode(savedMode);

        const targetId = cachedActiveId && notes.some((n) => n.id === cachedActiveId)
            ? cachedActiveId
            : notes.length > 0
                ? notes[0].id
                : null;

        if (targetId) {
            selectNote(targetId);
        } else {
            renderNotesList();
        }

        repoStatusIndicator.textContent = `${githubConfig.repo}:${cleanBranchName(githubConfig.branch)}`;
        if (window.innerWidth <= 768) {
            toggleSidebar(true);
        }
        addDiagLog("FastNote Industrial Technocracy Text Studio zainicjalizowany.");
    } catch (err) {
        console.error(err);
    }
    lucide.createIcons();
});