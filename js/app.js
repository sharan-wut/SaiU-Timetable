import { CONFIG } from './config.js';
import { parseCSV } from './parser.js';
import { getSection as getStoredSection, setSection as setStoredSection, hasSeenSectionModal, markSectionModalSeen } from './storage.js';
import * as nav from './navigation.js';
import * as ui from './ui.js';
import { todayName, nowMinutes, nextSchoolDay, isSchoolDay, toMinutes } from './utils.js';
import { init as initAnalytics, trackEvent } from './analytics.js';
import { getRoomAvailability } from './rooms.js';

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

let selectedRoomTime = 'now';
let roomSearchQuery = '';

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

// ============================================================
// Navigation state rendering
// ============================================================

function renderNavigation() {
    const school = nav.getSchool();
    const program = nav.getProgram();
    const year = nav.getYear();

    ui.renderSidebar({
        viewMode: nav.getViewMode(),
        schools: nav.availableSchools(),
        schoolId: school?.id || null,
        programs: nav.availablePrograms(),
        programId: program?.id || null,
        years: nav.availableYears(),
        yearId: year?.id || null,
        sections: nav.availableSections(),
        sectionId: selectedSection,
    });

    ui.renderDayFilter(selectedDay || contextDay());
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
    if (!sheetUrl) { ui.renderError(); return; }

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

    ui.setRefreshSpinning(!silent);
    try {
        const res = await fetch(sheetUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        const parsed = parseCSV(text, nav.getParserType(), nav.getTrackedCourses());
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
    try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; }
    catch { return null; }
}

function writeCache(key, data) {
    try { localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), classes: data })); }
    catch { /* full */ }
}

function updateRoomMapWithKey(classes) {
    const key = getRoomCacheKey();
    const PLACEHOLDER = /^(tba|tbd|to be announced|to be decided|room tba|n\/?a)$/i;
    let map = {};
    try { const raw = localStorage.getItem(key); map = raw ? JSON.parse(raw) : {}; } catch { map = {}; }
    for (const c of classes) {
        const ck = `${c.subject}|${c.faculty}|${c.section ?? ''}|${c.day ?? ''}|${c.startTime ?? ''}`;
        const rawRoom = String(c.room ?? '').replace(/\s+/g, ' ').trim();
        const room = rawRoom && !PLACEHOLDER.test(rawRoom) ? rawRoom.toLowerCase() : '';
        const prevRaw = String(map[ck] ?? '').trim();
        const prev = prevRaw && !PLACEHOLDER.test(prevRaw) ? prevRaw.toLowerCase() : '';
        if (room && prev && prev !== room) { c.roomChanged = true; c.originalRoom = prevRaw; }
        if (room) map[ck] = rawRoom;
    }
    try { localStorage.setItem(key, JSON.stringify(map)); } catch { /* full */ }
}

// ============================================================
// Render
// ============================================================

function render() {
    ui.hideLoading();
    renderNavigation();
    const day = selectedDay || contextDay();
    ui.renderSuccess();
    const viewMode = nav.getViewMode();

    const scheduleSection = $('#schedule-section');
    const freeRoomsSection = $('#free-rooms-section');
    const titleEl = $('#timeline-title');

    if (viewMode === 'free-rooms') {
        if (scheduleSection) scheduleSection.classList.add('hidden');
        if (freeRoomsSection) freeRoomsSection.classList.remove('hidden');
        if (titleEl) titleEl.textContent = 'Free Classrooms Finder';

        const now = nowMinutes();
        const targetTimeMin = selectedRoomTime === 'now' ? now : toMinutes(selectedRoomTime);
        const availability = getRoomAvailability(classes, day, targetTimeMin, roomSearchQuery);
        ui.renderFreeRoomsView(availability, day);
    } else {
        if (freeRoomsSection) freeRoomsSection.classList.add('hidden');
        if (scheduleSection) scheduleSection.classList.remove('hidden');
        if (titleEl) titleEl.textContent = "Today's Schedule";

        const now = nowMinutes();
        const sc = sectionClasses();
        const ctx = ui.computeHighlight(sc, now, day);
        ui.renderTimeline(now, day, ctx, '');

        lastFeatureKey = (ctx.current || ctx.next)
            ? `${(ctx.current || ctx.next).subject}|${(ctx.current || ctx.next).startTime}|${ctx.current ? 1 : 0}`
            : 'none';
    }

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
        const viewMode = nav.getViewMode();

        if (viewMode === 'free-rooms') {
            if (selectedRoomTime === 'now') {
                render();
            }
            return;
        }

        const sc = sectionClasses();
        const ctx = ui.computeHighlight(sc, now, day);
        const key = ctx.current || ctx.next
            ? `${(ctx.current || ctx.next).subject}|${(ctx.current || ctx.next).startTime}|${ctx.current ? 1 : 0}`
            : 'none';
        if (key !== lastFeatureKey) { lastFeatureKey = key; render(); return; }
        if (day === todayName()) ui.updateLiveClock(now, ctx.current, ctx.next);
    }, 60 * 1000);
}

function stopCountdown() {
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
}

// ============================================================
// Pull to refresh
// ============================================================

let pullStart = 0, pulling = false;

function initPullToRefresh() {
    const indicator = $('.pull-indicator');
    if (!indicator) return;
    const threshold = 90;
    window.addEventListener('touchstart', (e) => {
        if (ui.isDrawerOpen()) return;
        if (window.scrollY <= 0) { pullStart = e.touches[0].clientY; pulling = true; }
    }, { passive: true });
    window.addEventListener('touchmove', (e) => {
        if (!pulling || pullStart <= 0) return;
        const dy = e.touches[0].clientY - pullStart;
        if (dy > 0) { indicator.classList.add('visible'); if (dy >= threshold) indicator.classList.add('active'); }
    }, { passive: true });
    window.addEventListener('touchend', () => {
        if (indicator.classList.contains('active')) load({ silent: true });
        indicator.classList.remove('visible', 'active');
        pulling = false; pullStart = 0;
    }, { passive: true });
}

// ============================================================
// Actions
// ============================================================

function initActions() {
    const refresh = () => load({ silent: true });
    $('#refresh-btn-mobile')?.addEventListener('click', refresh);
    $('.retry-btn')?.addEventListener('click', () => load());

    const handleInstall = async () => {
        if (deferredPrompt) {
            console.log('[PWA] Triggering native install prompt');
            deferredPrompt.prompt();
            const { outcome } = await deferredPrompt.userChoice;
            console.log('[PWA] User choice:', outcome);
            if (outcome === 'accepted') {
                hideInstallButton();
            }
            deferredPrompt = null;
        } else if (isStandalone()) {
            console.log('[PWA] Already installed');
            ui.showToast('Already installed');
        } else {
            const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
            const isAndroid = /Android/i.test(navigator.userAgent);
            if (isIOS) {
                console.log('[PWA] iOS — no programmatic install, showing share sheet instructions');
                ui.showToast('Tap Share \u2192 Add to Home Screen');
            } else if (isAndroid) {
                console.log('[PWA] Android but no deferredPrompt — showing menu instructions');
                ui.showToast('Tap browser menu \u2192 Install app');
            } else {
                console.log('[PWA] Desktop but no deferredPrompt — showing address bar instructions');
                ui.showToast('Click the install icon in your address bar');
            }
        }
    };
    $('#install-btn')?.addEventListener('click', handleInstall);
    $('#install-btn-mobile')?.addEventListener('click', handleInstall);

    $('#nav-btn-timetable')?.addEventListener('click', () => {
        nav.setViewMode('timetable');
        ui.closeDrawer();
    });
    $('#nav-btn-freerooms')?.addEventListener('click', () => {
        nav.setViewMode('free-rooms');
        ui.closeDrawer();
    });

    const timePills = document.querySelectorAll('.time-pill');
    timePills.forEach(pill => {
        pill.addEventListener('click', () => {
            timePills.forEach(p => p.classList.remove('active'));
            pill.classList.add('active');
            selectedRoomTime = pill.dataset.time;
            render();
        });
    });

    $('#rooms-search-input')?.addEventListener('input', (e) => {
        roomSearchQuery = e.target.value;
        render();
    });
}

// ============================================================
// Hamburger / drawer
// ============================================================

function initHamburger() {
    $('#hamburger-btn')?.addEventListener('click', () => {
        if (ui.isDrawerOpen()) ui.closeDrawer(); else ui.openDrawer();
    });
    $('#drawer-overlay')?.addEventListener('click', () => ui.closeDrawer());
    $('#sidebar-close-btn')?.addEventListener('click', () => ui.closeDrawer());
    $('.section-modal-backdrop')?.addEventListener('click', () => ui.hideSectionModal());
}

// ============================================================
// Navigation event handlers
// ============================================================

function initNavigationListeners() {
    window.addEventListener('schoolchange', (e) => {
        nav.navigateToSchool(e.detail.schoolId);
        selectedSection = nav.getState().section;
        trackEvent('school_changed', { school: e.detail.schoolId });
        load(); ui.closeDrawer();
    });
    window.addEventListener('programchange', (e) => {
        nav.navigateToProgram(e.detail.programId);
        selectedSection = nav.getState().section;
        trackEvent('program_changed', { program: e.detail.programId });
        load(); ui.closeDrawer();
    });
    window.addEventListener('yearchange', (e) => {
        nav.navigateToYear(e.detail.yearId);
        selectedSection = nav.getState().section;
        trackEvent('year_changed', { year: e.detail.yearId });
        load(); ui.closeDrawer();
    });
    window.addEventListener('sectionchange', (e) => {
        const s = e.detail.section;
        if (s === selectedSection) return;
        selectedSection = s;
        nav.navigateToSection(s);
        trackEvent('section_changed', { section: s });
        render(); ui.closeDrawer();
    });
    window.addEventListener('daychange', (e) => {
        selectedDay = e.detail.day;
        trackEvent('weekday_changed', { weekday: e.detail.day });
        render();
    });
    window.addEventListener('viewmodechange', () => {
        render();
    });
    window.addEventListener('navchange', () => renderNavigation());
}

function initAutoRefresh() {
    setInterval(() => load({ background: true }), CONFIG.REFRESH_INTERVAL);
}

// ============================================================
// PWA
// ============================================================

let deferredPrompt = null;

function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches ||
        window.matchMedia('(display-mode: fullscreen)').matches ||
        window.matchMedia('(display-mode: minimal-ui)').matches ||
        window.matchMedia('(display-mode: window-controls-overlay)').matches ||
        navigator.standalone === true;
}

function showInstallButton() {
    $('#install-btn')?.classList.remove('hidden');
    $('#install-btn-mobile')?.classList.remove('hidden');
}

function hideInstallButton() {
    $('#install-btn')?.classList.add('hidden');
    $('#install-btn-mobile')?.classList.add('hidden');
}

function initPWA() {
    // Register service worker
    if ('serviceWorker' in navigator) {
        const devHost = ['localhost', '127.0.0.1', '::1', '0.0.0.0'].includes(location.hostname);
        if (!devHost && location.protocol.startsWith('https')) {
            navigator.serviceWorker.register('./sw.js')
                .then((reg) => {
                    console.log('[PWA] Service Worker registered, scope:', reg.scope);
                })
                .catch((err) => {
                    console.warn('[PWA] Service Worker registration failed:', err);
                });
        } else {
            console.log('[PWA] Skipping SW registration on dev host');
        }
    }

    // Already installed — hide button
    if (isStandalone()) {
        console.log('[PWA] Running in standalone mode — already installed');
        hideInstallButton();
        return;
    }

    // Listen for the browser's install prompt
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e;
        console.log('[PWA] beforeinstallprompt captured — install available');
        showInstallButton();
    });

    // App was just installed
    window.addEventListener('appinstalled', () => {
        console.log('[PWA] App installed successfully');
        deferredPrompt = null;
        hideInstallButton();
        trackEvent('pwa_installed');
    });

    // Debug: log if beforeinstallprompt never fires after 5s
    setTimeout(() => {
        if (!deferredPrompt && !isStandalone()) {
            console.warn('[PWA] beforeinstallprompt did not fire within 5s');
            console.warn('[PWA] Possible reasons:');
            console.warn('  - Browser does not support programmatic install');
            console.warn('  - App does not meet installability criteria (HTTPS, manifest, SW)');
            console.warn('  - User already dismissed the install infobar');
            console.warn('  - App is already installed');
        }
    }, 5000);
}

// ============================================================
// Legacy section migration
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
    initPWA();
    nav.initNavigation();
    migrateLegacySection();
    selectedSection = nav.getState().section;

    initHamburger();
    initPullToRefresh();
    initActions();
    initNavigationListeners();
    initAutoRefresh();

    load();
    startCountdown();
}

document.addEventListener('DOMContentLoaded', init);
