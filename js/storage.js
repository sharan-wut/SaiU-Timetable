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

export function updateRoomMap(classes) {
    const map = getRoomMap();
    let changed = false;
    for (const c of classes) {
        const key = `${c.subject}|${c.faculty}|${c.section ?? ''}`;
        const room = c.room || '';
        if (map[key] && map[key] !== room && room) {
            c.roomChanged = true;
            changed = true;
        }
        map[key] = room;
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
