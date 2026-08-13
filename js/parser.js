/**
 * CSV Parsers for timetable data.
 *
 * Two parser strategies:
 *   1. `grid` — the original SCDS format (day rows, time columns, (Sec N) labels)
 *   2. `list` — flat list format: Day, Time, Subject, Faculty, Room, Section
 *
 * The parser is selected dynamically per school/year from the config.
 */

const DAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
const SECTION_REGEX = /(?:\(|\b|[-–—])Sec\.?\s*(\d+)(?:\)|\b|[-–—])/i;

/**
 * Parse a CSV string into an array of class objects.
 * @param {string} text - raw CSV content
 * @param {string} [parserType='grid'] - 'grid' or 'list'
 * @param {string[]} [trackedCourses] - optional filter list for course names
 */
export function parseCSV(text, parserType = 'grid', trackedCourses = null) {
    const raw = parserType === 'list'
        ? parseListCSV(text)
        : parseGridCSV(text, trackedCourses);
    if (!trackedCourses || !trackedCourses.length) return raw;

    // Normalize tracked names for case-insensitive prefix matching.
    const tracked = trackedCourses.map(c => c.trim().toLowerCase());
    return raw.filter(c => {
        const subj = c.subject.trim().toLowerCase();
        return tracked.some(t => subj === t || subj.startsWith(t) || t.startsWith(subj));
    });
}

// ============================================================
// Grid parser (SCDS format)
// ============================================================

function parseGridCSV(text, trackedCourses = null) {
    const lines = text.split(/\r?\n/);
    const data = [];
    let currentDay = null;

    // Build a lookup for fast tracked-course matching
    const trackedSet = trackedCourses
        ? new Set(trackedCourses.map(c => c.trim().toLowerCase()))
        : null;

    for (let i = 0; i < lines.length; i++) {
        if (!lines[i].trim()) continue;

        const row = splitCSVLine(lines[i]);
        if (row.length < 3) continue;

        const col0 = row[0].toUpperCase();
        if (DAYS.includes(col0)) {
            currentDay = col0.charAt(0) + col0.slice(1).toLowerCase();
        }
        if (!currentDay) continue;

        const timeText = row[1];
        if (!timeText || /LUNCH|OPEN BLOCK/i.test(timeText)) continue;
        const times = parseTimeRange(timeText);
        if (!times) continue;

        for (let j = 2; j < row.length; j++) {
            const cell = row[j];
            if (!cell) continue;

            // Skip obvious noise cells: single chars, bare numbers, stray punctuation
            if (/^[\d\s()\-–—\/\\|]+$/.test(cell)) continue;
            if (cell.length < 3) continue;
            if (/^(LUNCH|BREAK|OPEN BLOCK|RECESS|CHAPEL)/i.test(cell.trim())) continue;

            const sectionMatch = cell.match(SECTION_REGEX);
            const { subject, faculty } = splitSubjectFaculty(cell);
            if (!subject || subject.length < 3) continue;
            // Skip subject strings that are still stray punctuation/numbers after cleaning
            if (/^[\d\s()\-–—\/\\|]+$/.test(subject)) continue;

            const room = findRoom(lines, i, j);
            const isLabColumn = j === 17 || /lab/i.test(room) || /lab/i.test(subject);

            if (sectionMatch) {
                const section = parseInt(sectionMatch[1], 10);
                if (!section) continue;

                data.push({
                    day: currentDay,
                    subject,
                    faculty,
                    room,
                    section,
                    isLab: isLabColumn,
                    startTime: times.start,
                    endTime: times.end,
                });
            } else if (isLabColumn) {
                data.push({
                    day: currentDay,
                    subject,
                    faculty,
                    room: room || 'Computer Lab',
                    section: 8,
                    isLab: true,
                    startTime: times.start,
                    endTime: times.end,
                });
            } else {
                const subjLower = subject.trim().toLowerCase();
                const isTracked = trackedSet ? [...trackedSet].some(t => subjLower === t || subjLower.startsWith(t) || t.startsWith(subjLower)) : true;
                if (isTracked) {
                    data.push({
                        day: currentDay,
                        subject,
                        faculty,
                        room,
                        section: null,
                        isElective: true,
                        startTime: times.start,
                        endTime: times.end,
                    });
                }
            }
        }
    }
    return data;
}

function splitCSVLine(line) {
    return line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(cell => cell.replace(/^"|"$/g, '').trim());
}

export function findRoom(lines, rowIdx, colIdx) {
    let emptyCount = 0;
    for (let k = rowIdx + 1; k < lines.length; k++) {
        if (!lines[k].trim()) continue;
        const row = splitCSVLine(lines[k]);

        // Stop if we reach a new day section
        if (row[0] && DAYS.includes(row[0].toUpperCase())) break;

        const cell = row[colIdx] || '';
        if (cell && !/LUNCH|OPEN BLOCK/i.test(cell) && !/\d\s*(AM|PM)/i.test(cell)) {
            return cell.replace(/\s+/g, ' ');
        }

        if (!cell) {
            emptyCount++;
            if (emptyCount > 5) break;
        } else {
            // Hit a non-room reserved keyword cell (e.g. LUNCH / OPEN BLOCK / time header)
            break;
        }
    }
    return '';
}

export function parseTimeRange(text) {
    const normalized = text.replace(/(\d)\.(\d)/g, '$1:$2').replace(/(\d)(AM|PM)/gi, '$1 $2');
    const m = normalized.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?\s*-\s*(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
    if (!m) return null;
    let startMeridiem = m[3];
    const endMeridiem = m[6];
    if (!startMeridiem && endMeridiem) {
        const startH = parseInt(m[1], 10);
        const endH = parseInt(m[4], 10);
        if (endMeridiem.toUpperCase() === 'PM') {
            if (startH < 8 || (startH <= endH && startH !== 12)) {
                startMeridiem = 'PM';
            } else {
                startMeridiem = 'AM';
            }
        } else if (endMeridiem.toUpperCase() === 'AM') {
            startMeridiem = 'AM';
        }
    }
    return {
        start: to24Hour(m[1], m[2], startMeridiem),
        end: to24Hour(m[4], m[5], endMeridiem),
    };
}

function to24Hour(h, min, meridiem) {
    let hour = parseInt(h, 10);
    const isPM = meridiem && meridiem.toUpperCase() === 'PM';
    if (isPM && hour !== 12) hour += 12;
    if (!isPM && hour === 12) hour = 0;
    return `${String(hour).padStart(2, '0')}:${min}`;
}

export function splitSubjectFaculty(cell) {
    let clean = (cell || '').trim();
    if (!clean) return { subject: '', faculty: '' };

    // Remove surrounding double-quotes if any
    clean = clean.replace(/^"|"$/g, '').trim();

    let subject = '';
    let faculty = '';

    const mSec = clean.match(/^(.*?)\s*(?:[-–—]\s*)?(?:\(|\b|[-–—])Sec\.?\s*\d+(?:\)|\b|[-–—])\s*(?:[-–—]\s*)?(.*)$/i);
    if (mSec && (mSec[1].trim() || mSec[2].trim())) {
        subject = mSec[1].replace(/[-–—\s]+$/, '').trim();
        faculty = mSec[2].replace(/^[-–—\s]+/, '').trim();
    } else {
        const parts = clean.split(/\s{2,}/).map(p => p.trim()).filter(Boolean)
            .filter(p => !/^(?:\(|\b|[-–—])Sec\.?\s*\d+(?:\)|\b|[-–—])$/i.test(p));
        subject = (parts[0] || '').replace(/\s*(?:\(|\b|[-–—])Sec\.?\s*\d+(?:\)|\b|[-–—])/gi, '').trim();
        faculty = parts.slice(1).join(' ');
        if (!faculty && /[-–—]\s*\S/.test(clean)) {
            const m = clean.match(/^(.*?)\s*[-–—]\s*(.+)$/);
            if (m) {
                subject = m[1].replace(/\s*(?:\(|\b|[-–—])Sec\.?\s*\d+(?:\)|\b|[-–—])/gi, '').trim();
                faculty = m[2].trim();
            }
        }
    }

    // Clean up subject: remove trailing unclosed parentheses
    subject = subject.replace(/\s*\([^)]*$/, '').trim();

    if (faculty) {
        faculty = faculty.replace(/^(?:[-–—\s]*Sem\s*\d+\s*[-–—\s]*)+/i, '').trim();
        faculty = faculty.replace(/^\((.+)\)$/, '$1').trim();
        // Strip stray leading/trailing parens/punctuation
        faculty = faculty.replace(/^[()]+/, '').replace(/[()]+$/, '').trim();
        faculty = faculty.replace(/^(Dr|Prof)\.([A-Z])/i, '$1. $2');
        faculty = faculty.replace(/^[-–—\s]+/, '').trim();
        // Ignore pure stray values
        if (/^[\d\s()\-–—]+$/.test(faculty)) faculty = '';
    }

    return { subject, faculty };
}

// ============================================================
// List parser (SOAI / SOB format)
// Expected columns: Day, Time, Subject, Faculty, Room, [Section]
// Time column may be a range "09:00-10:00" or "09:00 AM - 10:00 AM".
// ============================================================

function parseListCSV(text) {
    const lines = text.split(/\r?\n/);
    const data = [];

    // Detect header row — skip it if the first column looks like a label.
    let startIdx = 0;
    if (lines.length && /^(day|weekday|date)/i.test(lines[0])) startIdx = 1;

    for (let i = startIdx; i < lines.length; i++) {
        if (!lines[i].trim()) continue;
        const row = splitCSVLine(lines[i]);
        if (row.length < 4) continue;

        const dayRaw = row[0].trim();
        const col0Upper = dayRaw.toUpperCase();
        const dayMatch = DAYS.includes(col0Upper);
        if (!dayMatch) continue;

        const day = col0Upper.charAt(0) + col0Upper.slice(1).toLowerCase();
        const timeText = row[1].trim();
        if (!timeText || /LUNCH|OPEN BLOCK/i.test(timeText)) continue;

        const times = parseTimeRange(timeText);
        if (!times) continue;

        const subject = (row[2] || '').trim();
        if (!subject) continue;

        const faculty = (row[3] || '').trim();
        const room = (row[4] || '').trim();

        // Section is optional — defaults to 1 for single-section schools.
        let section = 1;
        if (row[5]) {
            const n = parseInt(row[5], 10);
            if (Number.isFinite(n) && n > 0) section = n;
        }

        data.push({
            day,
            subject,
            faculty,
            room,
            section,
            startTime: times.start,
            endTime: times.end,
        });
    }
    return data;
}
