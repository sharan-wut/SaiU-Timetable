import { toMinutes } from './utils.js';

const INVALID_ROOM_REGEX = /^(tba|tbd|to be announced|to be decided|room tba|n\/?a|\s*)$/i;

/**
 * Clean and normalize room name. Returns empty string if invalid/TBA.
 */
export function normalizeRoomName(roomRaw) {
    if (!roomRaw) return '';
    const cleaned = String(roomRaw).replace(/\s+/g, ' ').trim();
    if (INVALID_ROOM_REGEX.test(cleaned)) return '';
    return cleaned;
}

/**
 * Extract all unique valid room names from a set of class objects.
 */
export function extractUniqueRooms(classes = []) {
    const map = new Map();
    for (const c of classes) {
        const room = normalizeRoomName(c.room);
        if (room) {
            const lower = room.toLowerCase();
            if (!map.has(lower)) {
                map.set(lower, room);
            }
        }
    }
    return [...map.values()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
}

/**
 * Compute availability state for all rooms on a given day and time (in minutes from midnight).
 *
 * @param {Array} classes - List of all class objects across schedules
 * @param {string} day - Weekday name (e.g. 'Monday')
 * @param {number} timeMinutes - Target time in minutes
 * @param {string} [searchQuery=''] - Optional filter string
 */
export function getRoomAvailability(classes = [], day, timeMinutes, searchQuery = '') {
    const allRooms = extractUniqueRooms(classes);
    const dayLower = day ? day.trim().toLowerCase() : '';

    // Filter classes for the specific day
    const dayClasses = classes.filter(c => c.day && c.day.trim().toLowerCase() === dayLower && normalizeRoomName(c.room));

    const results = allRooms.map(roomName => {
        const roomLower = roomName.toLowerCase();
        const roomClasses = dayClasses.filter(c => normalizeRoomName(c.room).toLowerCase() === roomLower);

        // Check if currently occupied
        const activeClass = roomClasses.find(c => {
            const start = toMinutes(c.startTime);
            const end = toMinutes(c.endTime);
            return timeMinutes >= start && timeMinutes < end;
        });

        if (activeClass) {
            const endMin = toMinutes(activeClass.endTime);
            return {
                roomName,
                isAvailable: false,
                currentClass: activeClass,
                occupiedUntil: activeClass.endTime,
                occupiedUntilMin: endMin,
            };
        } else {
            // Find next class scheduled in this room after target time
            const upcomingClasses = roomClasses
                .filter(c => toMinutes(c.startTime) > timeMinutes)
                .sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime));

            const nextClass = upcomingClasses[0] || null;
            const freeUntil = nextClass ? nextClass.startTime : null;
            const freeUntilMin = nextClass ? toMinutes(nextClass.startTime) : null;

            return {
                roomName,
                isAvailable: true,
                currentClass: null,
                freeUntil,
                freeUntilMin,
                nextClass,
            };
        }
    });

    // Apply search filter if provided
    let filtered = results;
    if (searchQuery && searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        filtered = results.filter(r => r.roomName.toLowerCase().includes(q));
    }

    // Separate into available and occupied
    const available = filtered.filter(r => r.isAvailable);
    const occupied = filtered.filter(r => !r.isAvailable);

    return {
        allRooms,
        available,
        occupied,
        totalCount: results.length,
        availableCount: available.length,
        occupiedCount: occupied.length,
    };
}
