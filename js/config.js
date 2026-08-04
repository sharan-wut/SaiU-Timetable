/**
 * Central configuration.
 * Change SHEET_ID here — the rest of the app reads from CONFIG.
 * Sections are NOT configured here: they are discovered from the "(Sec N)"
 * labels in the published Google Sheet, so adding a section is a data-only change.
 */
export const CONFIG = {
    SHEET_ID: '1Jk3KCLqHHzi-jxigIcPpcXZestcxb8Y0BeQLjhiezb8',
    GID: '0',
    REFRESH_INTERVAL: 5 * 60 * 1000, // auto-refresh period (ms)

    // Active weekdays shown in the selector and used by navigation.
    // Weekends are excluded by default; add them here to re-enable.
    WEEKDAYS: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],

    // Cache keys (localStorage)
    CACHE_KEY: 'tt-timetable-cache-v1',
    ROOMS_KEY: 'tt-room-map-v1',
    SECTION_KEY: 'tt-section',

    // Any gap between classes >= this many minutes is shown as a break
    BREAK_THRESHOLD_MIN: 40,
    // Gaps overlapping this window are labelled "Lunch" instead of "Break"
    LUNCH_START: 12 * 60,
    LUNCH_END: 15 * 60,
};
