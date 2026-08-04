/**
 * CSV Parser for the grid-style timetable.
 * Cells are labelled "(Sec N)" (e.g. "Linear Algebra (Sec 3)  Tamilarasi").
 * Every section found in the sheet is parsed — no section is hard-coded, so
 * adding a new section later only requires editing the Google Sheet.
 */

const DAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
const SECTION_REGEX = /\(Sec\s*(\d+)\)/i;

export function parseCSV(text) {
    const lines = text.split(/\r?\n/);
    const data = [];
    let currentDay = null;

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

        // Parse every cell carrying a section label. A slot can hold one class
        // per section, so keep scanning the row for other sections.
        for (let j = 2; j < row.length; j++) {
            const cell = row[j];
            if (!cell) continue;

            const sectionMatch = cell.match(SECTION_REGEX);
            if (!sectionMatch) continue;

            const section = parseInt(sectionMatch[1], 10);
            if (!section) continue;

            const room = findRoom(lines, i, j);
            const { subject, faculty } = splitSubjectFaculty(cell);

            data.push({
                day: currentDay,
                subject,
                faculty,
                room,
                section,
                startTime: times.start,
                endTime: times.end
            });
        }
    }
    return data;
}

function splitCSVLine(line) {
    return line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(cell => cell.replace(/^"|"$/g, '').trim());
}

// The room for a class is in the same column of the following row(s)
export function findRoom(lines, rowIdx, colIdx) {
    for (let k = rowIdx + 1; k < lines.length; k++) {
        if (!lines[k].trim()) continue;
        const row = splitCSVLine(lines[k]);
        const cell = row[colIdx] || '';
        if (cell && !/LUNCH|OPEN BLOCK/i.test(cell) && !/\d\s*(AM|PM)/i.test(cell)) {
            return cell.replace(/\s+/g, ' ');
        }
        break;
    }
    return '';
}

// Parse messy time ranges like "11.15 AM - 12.10 PM", "01.00PM - 01.55PM"
export function parseTimeRange(text) {
    const normalized = text.replace(/(\d)\.(\d)/g, '$1:$2').replace(/(\d)(AM|PM)/gi, '$1 $2');
    const m = normalized.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?\s*-\s*(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
    if (!m) return null;
    return {
        start: to24Hour(m[1], m[2], m[3]),
        end: to24Hour(m[4], m[5], m[6])
    };
}

function to24Hour(h, min, meridiem) {
    let hour = parseInt(h, 10);
    const isPM = meridiem && meridiem.toUpperCase() === 'PM';
    if (isPM && hour !== 12) hour += 12;
    if (!isPM && hour === 12) hour = 0;
    return `${String(hour).padStart(2, '0')}:${min}`;
}

// Split "Subject (Sec 3)   Faculty Name" into subject and faculty
export function splitSubjectFaculty(cell) {
    const parts = cell.split(/\s{2,}/).map(p => p.trim()).filter(Boolean)
        .filter(p => !/^\(Sec\s*\d+\)$/i.test(p));
    let subject = (parts[0] || '').replace(/\s*\(Sec\s*\d+\)/i, '').trim();
    let faculty = parts.slice(1).join(' ');
    if (!faculty && /-\s*\S/.test(cell)) {
        const m = cell.match(/-\s*(.+)$/);
        if (m) faculty = m[1].trim();
    }
    return { subject, faculty };
}
