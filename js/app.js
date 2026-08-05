import { CONFIG } from './config.js';
import { parseCSV } from './parser.js';
import { getTheme as getStoredTheme, setTheme as setStoredTheme, getSection as getStoredSection, setSection as setStoredSection, hasSeenSectionModal, markSectionModalSeen } from './storage.js';
import * as nav from './navigation.js';
import * as ui from './ui.js';
import { todayName, nowMinutes, nextSchoolDay, isSchoolDay } from './utils.js';
import { init as initAnalytics, trackEvent } from './analytics.js';

/**
 * App bootstrap, fetch, and interactivity.
 */

let classes = [];
let sections = [];
let selectedSection = null;
let lastUpdated = null;
let selectedDay = null;
let countdownTimer = null;
let lastFeatureKey = null;

const $ = (sel) => document.querySelector(sel);

function contextDay() {
    const t = todayName();
    return isSchoolDay(t) ? t : nextSchoolDay(t);
}

function sectionClasses() {
    const yearConfig = nav.getYear();
    const hasSections = yearConfig && yearConfig.sections && yearConfig.sections.length > 1;
    if (!hasSections) return classes;
    return selectedSection == null ? [] : classes.filter(c => c.section === selectedSection);
}

function effectiveTheme(preference) {
    return preference === 'system'
        ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
        : preference;
}

function setThemeUI() {
    const preference = getStoredTheme();
    const eff = effectiveTheme(preference);
    document.documentElement.classList.remove('light-theme', 'dark-theme');
    document.documentElement.classList.add(eff + '-theme');
    const color = eff === 'dark' ? '#111111' : '#ffffff';
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => { m.content = color; });
    ui.setThemeIcon(preference);
}

function initTheme() {
    const media = matchMedia('(prefers-color-scheme: light)');
    media.addEventListener?.('change', () => {
        if (getStoredTheme() === 'system') setThemeUI();
    });
}

// ============================================================
// Navigation state rendering
// ============================================================

function renderNavigation() {
    const school = nav.getSchool();
    const program = nav.getProgram();
    const year = nav.getYear();

    // Desktop selectors
    ui.renderSchoolSelector(nav.availableSchools(), school?.id || null);
    ui.renderProgramSelector(nav.availablePrograms(), program?.id || null, nav.showProgramSelector());
    ui.renderYearSelector(nav.availableYears(), year?.id || null);
    ui.renderSectionSelector(sections, selectedSection);

    // Mobile drawer
    ui.renderDrawer({
        schools: nav.availableSchools(),
        schoolId: school?.id || null,
        programs: nav.availablePrograms(),
        programId: program?.id || null,
        years: nav.availableYears(),
        yearId: year?.id || null,
        sections: nav.availableSections(),
        sectionId: selectedSection,
    });

    // Update title
    const titleEl = $('#app-title');
    if (titleEl) {
        const parts = [school?.shortName || 'Timetable'];
        if (nav.showProgramSelector() && program) parts.push(program.label);
        if (year) parts.push(year.label);
        titleEl.textContent = parts.join(' · ');
    }

    // Section label in footer
    const label = $('#section-label');
    if (label) label.textContent = selectedSection ?? '';

    // Section row visibility
    const sectionRow = $('.section-row');
    if (sectionRow) sectionRow.classList.toggle('hidden', !nav.showSectionSelector());
}

function syncSections() {
    const yearConfig = nav.getYear();
    if (!yearConfig) return;

    const yearSections = yearConfig.sections || [];
    if (yearSections.length) {
        sections = yearSections;
        if (selectedSection == null) {
            if (!hasSeenSectionModal()) {
                markSectionModalSeen();
                ui.showSectionModal(sections, (s) => {
                    selectedSection = s;
                    nav.navigateToSection(s);
                    render();
                });
            }
        } else if (!sections.includes(selectedSection)) {
            selectedSection = sections[0];
            nav.navigateToSection(selectedSection);
        }
    } else {
        sections = [];
        selectedSection = null;
    }
}

// ============================================================
// Data loading
// ============================================================

function getCacheKey() {
    const year = nav.getYear();
    if (!year) return CONFIG.CACHE_KEY;
    return `tt-cache-${year.id}`;
}

function getRoomCacheKey() {
    const year = nav.getYear();
    if (!year) return CONFIG.ROOMS_KEY;
    return `tt-rooms-${year.id}`;
}

async function load({ silent = false, background = false } = {}) {
    const sheetUrl = nav.getSheetUrl();
    if (!sheetUrl) {
        ui.renderError();
        return;
    }

    // 1. Show cached data immediately
    const cacheKey = getCacheKey();
    const cached = readCache(cacheKey);
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
        const res = await fetch(sheetUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        const parserType = nav.getParserType();
        const trackedCourses = nav.getTrackedCourses();
        const parsed = parseCSV(text, parserType, trackedCourses);
        if (!parsed.length) throw new Error('No classes parsed');
        classes = parsed;
        lastUpdated = new Date();
        writeCache(cacheKey, classes);
        updateRoomMapWithKey(classes);
        syncSections();
        render();
        trackEvent('timetable_refreshed', { source: background ? 'background' : silent ? 'manual' : 'initial' });
        if (!silent) ui.showToast('Timetable refreshed');
    } catch {
        if (!cached) ui.renderError();
        if (!silent) ui.showToast('Offline — showing cached schedule');
    } finally {
        ui.setRefreshSpinning(false);
    }
}

function readCache(key) {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
    } catch { return null; }
}

function writeCache(key, data) {
    try {
        localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), classes: data }));
    } catch { /* full */ }
}

function updateRoomMapWithKey(classes) {
    const key = getRoomCacheKey();
    const PLACEHOLDER_ROOMS = /^(tba|tbd|to be announced|to be decided|room tba|n\/?a)$/i;
    let map = {};
    try {
        const raw = localStorage.getItem(key);
        map = raw ? JSON.parse(raw) : {};
    } catch { map = {}; }

    for (const c of classes) {
        const classKey = `${c.subject}|${c.faculty}|${c.section ?? ''}|${c.day ?? ''}|${c.startTime ?? ''}`;
        const rawRoom = String(c.room ?? '').replace(/\s+/g, ' ').trim();
        const room = rawRoom && !PLACEHOLDER_ROOMS.test(rawRoom) ? rawRoom.toLowerCase() : '';
        const prevRaw = String(map[classKey] ?? '').trim();
        const prev = prevRaw && !PLACEHOLDER_ROOMS.test(prevRaw) ? prevRaw.toLowerCase() : '';
        if (room && prev && prev !== room) {
            c.roomChanged = true;
            c.originalRoom = prevRaw;
        }
        if (room) map[classKey] = rawRoom;
    }
    try { localStorage.setItem(key, JSON.stringify(map)); } catch { /* full */ }
}

// ============================================================
// Render
// ============================================================

function render() {
    ui.hideLoading();
    ui.renderDateLine();
    renderNavigation();
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
}

// ============================================================
// Countdown
// ============================================================

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
            lastFeatureKey = key;
            render();
            return;
        }
        if (day === todayName()) ui.updateLiveClock(now, ctx.current, ctx.next);
    }, 60 * 1000);
}

function stopCountdown() {
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
}

// ============================================================
// Pull to refresh
// ============================================================

const pull = $('.pull-indicator');
let pullStart = 0;
let pulling = false;

function initPullToRefresh() {
    const threshold = 90;
    window.addEventListener('touchstart', (e) => {
        if (ui.isDrawerOpen()) return;
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

// ============================================================
// Search
// ============================================================

function initSearch() {
    const input = $('.search-input');
    const clear = $('.search-clear');
    let searchTimer = null;

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
        clearTimeout(searchTimer);
        const q = input.value.trim();
        if (!q) return;
        searchTimer = setTimeout(() => trackEvent('search_used', { search_term: q }), 600);
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

// ============================================================
// Header actions
// ============================================================

function initHeaderActions() {
    $('#refresh-btn')?.addEventListener('click', () => load({ silent: true }));

    const cycleTheme = () => {
        const next = { dark: 'light', light: 'system', system: 'dark' }[getStoredTheme()] || 'light';
        setStoredTheme(next);
        setThemeUI();
        trackEvent('theme_changed', { theme: next });
    };

    $('#theme-btn')?.addEventListener('click', cycleTheme);
    $('.drawer-theme-btn')?.addEventListener('click', cycleTheme);

    $('#install-btn')?.addEventListener('click', () => {
        if (window.deferredPrompt) {
            window.deferredPrompt.prompt();
            window.deferredPrompt.userChoice.then(() => { window.deferredPrompt = null; });
        } else {
            ui.showToast('Open the browser menu → "Install app"');
        }
    });
    $('.retry-btn')?.addEventListener('click', () => load());
}

// ============================================================
// Hamburger / drawer
// ============================================================

function initHamburger() {
    const btn = $('#hamburger-btn');
    if (btn) {
        btn.addEventListener('click', () => {
            if (ui.isDrawerOpen()) ui.closeDrawer();
            else ui.openDrawer();
        });
    }

    const overlay = $('#drawer-overlay');
    if (overlay) {
        overlay.addEventListener('click', () => ui.closeDrawer());
    }

    const closeBtn = $('.drawer-close-btn');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => ui.closeDrawer());
    }

    // Close section modal on backdrop click
    const modalBackdrop = $('.section-modal-backdrop');
    if (modalBackdrop) {
        modalBackdrop.addEventListener('click', () => ui.hideSectionModal());
    }
}

// ============================================================
// Navigation event handlers
// ============================================================

function initDayFilter() {
    window.addEventListener('daychange', (e) => {
        selectedDay = e.detail.day;
        trackEvent('weekday_changed', { weekday: e.detail.day });
        render();
    });
}

function initSectionSelector() {
    window.addEventListener('sectionchange', (e) => {
        const s = e.detail.section;
        if (s === selectedSection) return;
        selectedSection = s;
        nav.navigateToSection(s);
        trackEvent('section_changed', { section: s });
        render();
        ui.closeDrawer();
    });
}

function initNavigationListeners() {
    window.addEventListener('schoolchange', (e) => {
        nav.navigateToSchool(e.detail.schoolId);
        selectedSection = nav.getState().section;
        trackEvent('school_changed', { school: e.detail.schoolId });
        load();
        ui.closeDrawer();
    });

    window.addEventListener('programchange', (e) => {
        nav.navigateToProgram(e.detail.programId);
        selectedSection = nav.getState().section;
        trackEvent('program_changed', { program: e.detail.programId });
        load();
        ui.closeDrawer();
    });

    window.addEventListener('yearchange', (e) => {
        nav.navigateToYear(e.detail.yearId);
        selectedSection = nav.getState().section;
        trackEvent('year_changed', { year: e.detail.yearId });
        load();
        ui.closeDrawer();
    });

    window.addEventListener('navchange', () => {
        renderNavigation();
    });
}

function initAutoRefresh() {
    setInterval(() => load({ background: true }), CONFIG.REFRESH_INTERVAL);
}

function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches ||
        window.matchMedia('(display-mode: fullscreen)').matches ||
        window.matchMedia('(display-mode: minimal-ui)').matches ||
        window.matchMedia('(display-mode: window-controls-overlay)').matches ||
        navigator.standalone === true;
}

function initPWA() {
    if ('serviceWorker' in navigator) {
        const devHost = ['localhost', '127.0.0.1', '::1', '0.0.0.0'].includes(location.hostname);
        if (devHost || !location.protocol.startsWith('https')) {
            navigator.serviceWorker.getRegistrations()
                .then(regs => Promise.all(regs.map(r => r.unregister())))
                .catch(() => {});
        } else {
            navigator.serviceWorker.register('./sw.js').catch(() => {});
        }
    }

    if (isStandalone()) return;

    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        window.deferredPrompt = e;
        $('#install-btn').classList.remove('hidden');
    });
    window.addEventListener('appinstalled', () => {
        window.deferredPrompt = null;
        $('#install-btn').classList.add('hidden');
        trackEvent('pwa_installed');
    });
}

// ============================================================
// Legacy section persistence migration
// ============================================================

function migrateLegacySection() {
    const legacySection = getStoredSection();
    if (legacySection != null) {
        setStoredSection(null);
        const year = nav.getYear();
        if (year && year.sections && year.sections.includes(legacySection)) {
            selectedSection = legacySection;
            nav.navigateToSection(legacySection);
        }
    }
}

// ============================================================
// Bootstrap
// ============================================================

function init() {
    initAnalytics();
    initTheme();
    setThemeUI();
    initPWA();

    // Set footer year
    const yearEl = $('#year');
    if (yearEl) yearEl.textContent = new Date().getFullYear();

    nav.initNavigation();
    migrateLegacySection();

    const navState = nav.getState();
    selectedSection = navState.section;

    initHamburger();
    initPullToRefresh();
    initSearch();
    initHeaderActions();
    initDayFilter();
    initSectionSelector();
    initNavigationListeners();
    initAutoRefresh();

    load();
    startCountdown();
}

document.addEventListener('DOMContentLoaded', init);
