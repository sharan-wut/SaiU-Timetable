import { CONFIG } from './config.js';

/**
 * localStorage persistence: timetable cache, room-change map, theme.
 */

function read(key) {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

function write(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch {
        // storage full / private mode — non-fatal
    }
}

export function getCachedTimetable() {
    return read(CONFIG.CACHE_KEY);
}

export function setCachedTimetable(data) {
    write(CONFIG.CACHE_KEY, { savedAt: Date.now(), classes: data });
}

// Room-change detection: persist the room each subject/faculty was seen in.
// The section is part of the key so identical classes in different sections
// (with different rooms) are not reported as false "room changed" alerts.
export function getRoomMap() {
    return read(CONFIG.ROOMS_KEY) || {};
}

// Rooms that mean "not assigned" — never treated as a real value.
const PLACEHOLDER_ROOMS = /^(tba|tbd|to be announced|to be decided|room tba|n\/?a)$/i;

// Normalize a room for comparison: null/undefined become '', whitespace is
// trimmed and collapsed, case is ignored, and placeholder values are treated
// as missing. Two classes with the same room always normalize identically.
export function normalizeRoom(room) {
    if (room == null) return '';
    const s = String(room).replace(/\s+/g, ' ').trim();
    if (!s || PLACEHOLDER_ROOMS.test(s)) return '';
    return s.toLowerCase();
}

// Room-change detection: persist the room each class instance was seen in.
// The key includes day + start time because a grid timetable schedules the
// same subject/faculty/section in different rooms on different days — those
// are normal, not changes. A change is only flagged when BOTH the previously
// seen room and the current room exist (after normalization) and differ.
// Missing/placeholder values are treated as "no evidence" — never guessed.
export function updateRoomMap(classes) {
    const map = getRoomMap();
    let changed = false;
    for (const c of classes) {
        const key = `${c.subject}|${c.faculty}|${c.section ?? ''}|${c.day ?? ''}|${c.startTime ?? ''}`;
        const rawRoom = String(c.room ?? '').replace(/\s+/g, ' ').trim();
        const room = normalizeRoom(rawRoom);
        const prevRaw = String(map[key] ?? '').trim();
        const prev = normalizeRoom(prevRaw);
        if (room && prev && prev !== room) {
            c.roomChanged = true;
            c.originalRoom = prevRaw;
            changed = true;
        }
        // Keep the last known room. Never overwrite it with an empty value, so
        // a temporarily missing room cannot erase history.
        if (room) map[key] = rawRoom;
    }
    write(CONFIG.ROOMS_KEY, map);
    return changed;
}

export function getSection() {
    const raw = localStorage.getItem(CONFIG.SECTION_KEY);
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
}

export function setSection(section) {
    localStorage.setItem(CONFIG.SECTION_KEY, String(section));
}

export function getTheme() {
    return localStorage.getItem('tt-theme') || 'dark';
}

export function setTheme(theme) {
    localStorage.setItem('tt-theme', theme);
}
