import { CONFIG } from './config.js';
import { parseCSV } from './parser.js';
import { getCachedTimetable, setCachedTimetable, updateRoomMap, getTheme, setTheme, getSection, setSection } from './storage.js';
import * as ui from './ui.js';
import { todayName, nowMinutes, nextSchoolDay, isSchoolDay } from './utils.js';

/**
 * App bootstrap, fetch, and interactivity.
 */

const SHEET_URL = `https://docs.google.com/spreadsheets/d/${CONFIG.SHEET_ID}/export?format=csv&gid=${CONFIG.GID}`;

let classes = [];             // all classes for every section found in the sheet
let sections = [];            // unique section numbers present in the data
let selectedSection = getSection(); // remembered section; null on first visit
let lastUpdated = null;
let selectedDay = null;
let countdownTimer = null;
let sectionModalShown = false;
let lastFeatureKey = null;

const $ = (sel) => document.querySelector(sel);

// The day the app treats as "now": today on weekdays, the next school day on
// the weekend (so the timetable is never empty just because it's Saturday).
function contextDay() {
    const t = todayName();
    return isSchoolDay(t) ? t : nextSchoolDay(t);
}

// The timetable for the currently selected section only.
// Everything downstream (timeline, preview, countdown, search) works
// on this filtered list — no per-section code duplication.
function sectionClasses() {
    return selectedSection == null ? [] : classes.filter(c => c.section === selectedSection);
}

// Resolve a theme preference ("light" | "dark" | "system") to a concrete one.
function effectiveTheme(preference) {
    return preference === 'system'
        ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
        : preference;
}

function setThemeUI() {
    const preference = getTheme();
    const eff = effectiveTheme(preference);
    document.documentElement.classList.remove('light-theme', 'dark-theme');
    document.documentElement.classList.add(eff + '-theme');
    const meta = document.querySelector('#theme-color-meta');
    if (meta) meta.content = eff === 'dark' ? '#0b0c0e' : '#fafbfc';
    ui.setThemeIcon(preference);
}

function initTheme() {
    const media = matchMedia('(prefers-color-scheme: light)');
    media.addEventListener?.('change', () => {
        // Only react to the OS when the user is on "System" mode.
        if (getTheme() === 'system') setThemeUI();
    });
}

// Derive the available sections from the data and resolve the selected one.
// Called whenever the parsed timetable changes (cache or network).
function syncSections() {
    sections = [...new Set(classes.map(c => c.section))].sort((a, b) => a - b);
    if (!sections.length) return;

    if (selectedSection == null) {
        // First visit — ask the user once, then remember their choice.
        if (!sectionModalShown) {
            sectionModalShown = true;
            ui.showSectionModal(sections, (s) => {
                selectedSection = s;
                setSection(s);
                render();
            });
        }
    } else if (!sections.includes(selectedSection)) {
        // Remembered section no longer exists in the data (e.g. sheet changed).
        selectedSection = sections[0];
        setSection(selectedSection);
    }
}

async function load({ silent = false, background = false } = {}) {
    // 1. Show cached data immediately (offline-first)
    const cached = getCachedTimetable();
    if (cached && cached.classes) {
        classes = cached.classes;
        if (cached.savedAt) lastUpdated = new Date(cached.savedAt);
        syncSections();
        render();
    } else {
        ui.showLoading();
    }

    if (background) return;

    // 2. Fetch fresh data
    ui.setRefreshSpinning(!silent);
    try {
        const res = await fetch(SHEET_URL);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        const parsed = parseCSV(text);
        if (!parsed.length) throw new Error('No classes parsed');
        classes = parsed;
        lastUpdated = new Date();
        setCachedTimetable(classes);
        updateRoomMap(classes);
        syncSections();
        render();
        if (!silent) ui.showToast('Timetable refreshed');
    } catch {
        if (!cached) ui.renderError();
        if (!silent) ui.showToast('Offline — showing cached schedule');
    } finally {
        ui.setRefreshSpinning(false);
    }
}

function render() {
    ui.hideLoading();
    ui.renderDateLine();
    ui.renderSectionSelector(sections, selectedSection);
    const day = selectedDay || contextDay();
    ui.renderDayFilter(day);
    ui.renderSuccess();
    const now = nowMinutes();
    const sc = sectionClasses();
    const ctx = ui.computeHighlight(sc, now, day);
    ui.renderTimeline(now, day, ctx, $('.search-input')?.value || '');

    lastFeatureKey = (ctx.current || ctx.next)
        ? `${(ctx.current || ctx.next).subject}|${(ctx.current || ctx.next).startTime}|${ctx.current ? 1 : 0}`
        : 'none';

    ui.setLastUpdated(lastUpdated || new Date());
    const label = $('#section-label');
    if (label) label.textContent = selectedSection ?? '';
}

function startCountdown() {
    stopCountdown();
    countdownTimer = setInterval(() => {
        const now = nowMinutes();
        const day = selectedDay || contextDay();
        const sc = sectionClasses();
        const ctx = ui.computeHighlight(sc, now, day);
        const key = ctx.current || ctx.next
            ? `${(ctx.current || ctx.next).subject}|${(ctx.current || ctx.next).startTime}|${ctx.current ? 1 : 0}`
            : 'none';
        if (key !== lastFeatureKey) {
            // Class started / ended since the last render — refresh the timeline.
            lastFeatureKey = key;
            render();
            return;
        }
        // Same highlighted class: just tick the countdown / progress bar in place.
        if (day === todayName()) ui.updateLiveClock(now, ctx.current, ctx.next);
    }, 60 * 1000);
}

function stopCountdown() {
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
}

// --- Pull to refresh ---
const pull = $('.pull-indicator');
let pullStart = 0;
let pulling = false;

function initPullToRefresh() {
    const threshold = 90;
    window.addEventListener('touchstart', (e) => {
        if (window.scrollY <= 0) { pullStart = e.touches[0].clientY; pulling = true; }
    }, { passive: true });
    window.addEventListener('touchmove', (e) => {
        if (!pulling || pullStart <= 0) return;
        const dy = e.touches[0].clientY - pullStart;
        if (dy > 0) {
            pull.classList.add('visible');
            if (dy >= threshold) pull.classList.add('active');
        }
    }, { passive: true });
    window.addEventListener('touchend', () => {
        if (pull.classList.contains('active')) {
            load({ silent: true });
        }
        pull.classList.remove('visible', 'active');
        pulling = false;
        pullStart = 0;
    }, { passive: true });
}

function initSearch() {
    const input = $('.search-input');
    const clear = $('.search-clear');

    // Only the timeline depends on the query, so a keystroke re-renders just
    // that instead of the whole app (day / section stay untouched).
    const renderTimelineOnly = () => {
        const day = selectedDay || contextDay();
        const now = nowMinutes();
        const sc = sectionClasses();
        const ctx = ui.computeHighlight(sc, now, day);
        ui.renderTimeline(now, day, ctx, input.value);
    };

    input.addEventListener('input', () => {
        clear.classList.toggle('hidden', !input.value);
        renderTimelineOnly();
    });
    clear.addEventListener('click', () => {
        input.value = '';
        clear.classList.add('hidden');
        render();
    });
    window.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
            e.preventDefault();
            input.focus();
            input.select();
        } else if (e.key === 'Escape' && document.activeElement === input) {
            input.value = '';
            clear.classList.add('hidden');
            input.blur();
            renderTimelineOnly();
        }
    });
}

function initHeaderActions() {
    $('#refresh-btn').addEventListener('click', () => load({ silent: true }));
    $('#theme-btn').addEventListener('click', () => {
        const next = { dark: 'light', light: 'system', system: 'dark' }[getTheme()] || 'light';
        setTheme(next);
        setThemeUI();
    });
    $('#install-btn').addEventListener('click', () => {
        if (window.deferredPrompt) {
            window.deferredPrompt.prompt();
            window.deferredPrompt.userChoice.then(() => { window.deferredPrompt = null; });
        } else {
            ui.showToast('Open the browser menu → "Install app"');
        }
    });
    $('.retry-btn').addEventListener('click', () => load());
}

function initDayFilter() {
    window.addEventListener('daychange', (e) => {
        selectedDay = e.detail.day;
        render();
    });
}

function initSectionSelector() {
    window.addEventListener('sectionchange', (e) => {
        const s = e.detail.section;
        if (s === selectedSection) return;
        selectedSection = s;
        setSection(s);
        render();
    });
}

function initAutoRefresh() {
    setInterval(() => load({ background: true }), CONFIG.REFRESH_INTERVAL);
}

function initPWA() {
    if ('serviceWorker' in navigator) {
        // Live Server / local dev: never use a service worker. A stale worker
        // serves cached files, so edits and live-reload never show up.
        // sw.js also self-disarms on dev hosts; this unregister is a safety net
        // for any worker that was registered before that guard existed.
        const devHost = ['localhost', '127.0.0.1', '::1', '0.0.0.0'].includes(location.hostname);
        if (devHost || !location.protocol.startsWith('https')) {
            navigator.serviceWorker.getRegistrations()
                .then(regs => Promise.all(regs.map(r => r.unregister())))
                .catch(() => {});
        } else {
            navigator.serviceWorker.register('./sw.js').catch(() => {});
        }
    }
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        window.deferredPrompt = e;
        $('#install-btn').classList.remove('hidden');
    });
}

function init() {
    initTheme();
    setThemeUI();
    initPWA();
    initPullToRefresh();
    initSearch();
    initHeaderActions();
    initDayFilter();
    initSectionSelector();
    initAutoRefresh();
    load();
    startCountdown();
}

document.addEventListener('DOMContentLoaded', init);
