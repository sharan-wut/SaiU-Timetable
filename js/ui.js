import { CONFIG } from './config.js';
import { toMinutes, minutesToLabel, minutesToClock, todayName, isBeforeToday, WEEKDAYS } from './utils.js';

/**
 * DOM rendering — pure functions over the classes array.
 *
 * Page hierarchy (one continuous schedule, no duplicated classes):
 *   Today's Schedule   → the full timeline for the selected day; the current /
 *                        next class is highlighted inline with a countdown
 */

const $ = (sel) => document.querySelector(sel);

function svg(inner, size = 20) {
    return `<svg class="lucide" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}

// Lucide-style stroke icon set (consistent weight, no emoji).
const ICONS = {
    sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>'),
    moon: svg('<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>'),
    monitor: svg('<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>'),
    mapPin: svg('<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>', 15),
    clock: svg('<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>', 15),
    alertTriangle: svg('<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>', 13),
    calendarX: svg('<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/><path d="m15 14-6 6m0-6 6 6"/>', 40),
    circleAlert: svg('<circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/>', 40),
    checkCircle: svg('<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/>', 40),
    coffee: svg('<path d="M17 8h1a4 4 0 1 1 0 8h-1"/><path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z"/><path d="M6 2v2M10 2v2M14 2v2"/>', 14),
};

const THEME_CYCLE = { dark: 'light', light: 'system', system: 'dark' };

function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}

function byStart(a, b) {
    return toMinutes(a.startTime) - toMinutes(b.startTime);
}

export function setThemeIcon(preference) {
    const btn = $('#theme-btn');
    if (!btn) return;
    btn.innerHTML = ICONS[preference] || ICONS.moon;
    const next = THEME_CYCLE[preference] || 'light';
    const label = `Switch to ${next} theme`;
    btn.setAttribute('aria-label', label);
    btn.setAttribute('title', label);
}

// Real loading indicator: shown only while a fetch is in flight and there is
// no cached data to paint immediately. A 150ms display gate prevents a flash
// when the fetch resolves quickly.
export function showLoading() {
    const el = $('#loading-state');
    if (!el) return;
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.add('visible'), 150);
}

export function hideLoading() {
    const el = $('#loading-state');
    if (!el) return;
    clearTimeout(el._timer);
    el.classList.remove('visible');
}

export function renderDateLine() {
    const d = new Date();
    const weekday = d.toLocaleDateString(undefined, { weekday: 'long' });
    const date = d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    $('.date-line').innerHTML = `<strong>${weekday}</strong><span class="date-sep">·</span>${date}`;
}

// Idempotent: builds the weekday chips once, then only toggles active state.
// The chip set comes from CONFIG.WEEKDAYS, so weekends never render.
export function renderDayFilter(selectedDay) {
    const container = $('.day-filter');
    if (!container) return;
    if (!container.children.length) {
        for (const day of WEEKDAYS) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'day-chip';
            btn.dataset.day = day;
            btn.textContent = day.slice(0, 3);
            btn.setAttribute('aria-pressed', 'false');
            btn.setAttribute('aria-label', day);
            if (day === todayName()) btn.classList.add('today');
            btn.addEventListener('click', () => {
                window.dispatchEvent(new CustomEvent('daychange', { detail: { day } }));
            });
            container.appendChild(btn);
        }
        enableArrowNav(container);
    }
    for (const btn of container.children) {
        const active = btn.dataset.day === selectedDay;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
    // Snap the active chip into view on phones (no-op when the row doesn't
    // scroll, e.g. the static desktop grid).
    scrollChipIntoView(container, container.querySelector('.day-chip.active'), 'activeDay', selectedDay);
}

// Only scroll when the selection actually changed, so we never fight the user
// scrolling the row by hand while the live clock re-renders.
function scrollChipIntoView(container, chip, attr, value) {
    if (!chip || container.dataset[attr] === String(value)) return;
    container.dataset[attr] = String(value);
    if (container.scrollWidth <= container.clientWidth + 1) return;
    const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    chip.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', inline: 'center', block: 'nearest' });
}

// Idempotent: rebuilds only when the set of available sections changes.
export function renderSectionSelector(sections, selectedSection) {
    const container = $('#section-selector');
    if (!container) return;
    const sorted = [...new Set(sections)].sort((a, b) => a - b);
    const sig = sorted.join(',');
    if (container.dataset.sig !== sig) {
        container.innerHTML = '';
        container.dataset.sig = sig;
        for (const s of sorted) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'section-chip';
            btn.dataset.section = s;
            btn.textContent = s;
            btn.setAttribute('aria-pressed', 'false');
            btn.setAttribute('aria-label', `Section ${s}`);
            btn.addEventListener('click', () => {
                window.dispatchEvent(new CustomEvent('sectionchange', { detail: { section: s } }));
            });
            container.appendChild(btn);
        }
        enableArrowNav(container);
    }
    for (const btn of container.children) {
        const active = Number(btn.dataset.section) === selectedSection;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
    scrollChipIntoView(container, container.querySelector('.section-chip.active'), 'activeSection', selectedSection);
}

// Arrow / Home / End keyboard navigation for chip groups.
function enableArrowNav(container) {
    container.addEventListener('keydown', (e) => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;
        const buttons = [...container.querySelectorAll('button')];
        const idx = buttons.indexOf(document.activeElement);
        if (idx === -1) return;
        e.preventDefault();
        let next;
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = buttons[(idx + 1) % buttons.length];
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = buttons[(idx - 1 + buttons.length) % buttons.length];
        else if (e.key === 'Home') next = buttons[0];
        else if (e.key === 'End') next = buttons[buttons.length - 1];
        if (next) next.focus();
    });
}

/**
 * The class to highlight in the timeline for a given day + time.
 * Priority: current class → next class today → first class on a future day.
 * Past days get no highlight (every card reads "done").
 */
export function computeHighlight(classes, nowMin, day) {
    const dayClasses = classes.filter((c) => c.day === day).sort(byStart);
    if (day === todayName()) {
        const current = dayClasses.find((c) => toMinutes(c.startTime) <= nowMin && nowMin < toMinutes(c.endTime));
        const next = dayClasses.find((c) => toMinutes(c.startTime) > nowMin);
        return { dayClasses, current: current ?? null, next: next ?? null };
    }
    const next = isBeforeToday(day) ? null : (dayClasses[0] || null);
    return { dayClasses, current: null, next };
}

// Live countdown / progress for the highlighted timeline card. Falls back to
// nothing when there is no clock context (future days, search, day over).
export function updateLiveClock(nowMin, current, next) {
    const featured = current || next;
    if (!featured) {
        $('#timeline .tl-item.highlight .tl-countdown')?.remove();
        return;
    }
    const start = toMinutes(featured.startTime);
    const end = toMinutes(featured.endTime);
    const countdown = $('#timeline .tl-item.highlight .tl-countdown');
    if (countdown) {
        const text = current
            ? `${naturalDur(end - nowMin)} remaining`
            : start > nowMin ? `Starts in ${naturalDur(start - nowMin)}` : '';
        countdown.innerHTML = text ? `${ICONS.clock}<span>${text}</span>` : '';
    }
    const fill = $('#timeline .tl-item.highlight .progress-fill');
    if (fill) {
        const pct = Math.min(100, Math.max(0, ((nowMin - start) / (end - start)) * 100));
        fill.style.width = pct + '%';
    }
}

function naturalDur(totalMin) {
    const m = Math.max(0, Math.round(totalMin));
    if (m >= 60) {
        const h = Math.floor(m / 60);
        const mm = m % 60;
        return mm ? `${h} hr ${mm} min` : `${h} hr`;
    }
    return `${m} min`;
}

export function renderTimeline(nowMin, day, ctx, query = '') {
    const section = $('#schedule-section');
    const timeline = $('#timeline');
    if (!section || !timeline) return;

    const today = ctx.dayClasses;
    const q = query.trim().toLowerCase();

    const isToday = day === todayName();
    const dayStatus = isToday ? 'today' : (isBeforeToday(day) ? 'past' : 'future');
    // Current wins today; a future day's first class stands in as the anchor.
    const highlight = isToday
        ? (ctx.current || ctx.next)
        : (dayStatus === 'future' ? ctx.next : null);

    $('#timeline-title').textContent = isToday ? "Today's Schedule" : `${day}'s Schedule`;
    section.classList.remove('hidden');
    timeline.innerHTML = '';

    if (q) {
        const matches = today.filter((c) => [c.subject, c.faculty, c.room].join(' ').toLowerCase().includes(q));
        if (!matches.length) {
            $('#timeline-stats').textContent = '';
            timeline.innerHTML = `<li class="tl-search-empty">No classes match "${escapeHtml(query.trim())}".</li>`;
            return;
        }
        buildTimeline(timeline, matches, nowMin, true, dayStatus, null);
        $('#timeline-stats').textContent = `${matches.length} match${matches.length > 1 ? 'es' : ''}`;
        return;
    }

    if (!today.length) {
        $('#timeline-stats').textContent = '';
        timeline.innerHTML = `
            <li class="tl-done empty">
                <div class="tl-done-icon">${ICONS.calendarX}</div>
                <strong>No classes scheduled</strong>
                <span>There are no classes on ${day}.</span>
            </li>`;
        return;
    }

    buildTimeline(timeline, today, nowMin, false, dayStatus, highlight);

    if (isToday) {
        const remaining = today.filter((c) => toMinutes(c.endTime) > nowMin);
        if (!remaining.length) {
            $('#timeline-stats').textContent = 'All done';
            timeline.insertAdjacentHTML('afterbegin', `
                <li class="tl-done">
                    <div class="tl-done-icon">${ICONS.checkCircle}</div>
                    <strong>No more classes today</strong>
                    <span>See you tomorrow.</span>
                </li>`);
        } else {
            $('#timeline-stats').textContent = `${remaining.length} left`;
        }
    } else {
        $('#timeline-stats').textContent = `${today.length} class${today.length > 1 ? 'es' : ''}`;
    }
}

function buildTimeline(timeline, items, nowMin, skipBreaks, dayStatus = 'today', highlight = null) {
    let prevEnd = null;
    for (const c of items) {
        const startMin = toMinutes(c.startTime);
        const endMin = toMinutes(c.endTime);
        const status = dayStatus === 'past'
            ? 'completed'
            : dayStatus === 'future'
                ? 'upcoming'
                : (endMin <= nowMin ? 'completed' : (startMin <= nowMin ? 'current' : 'upcoming'));
        const hl = c === highlight;

        if (!skipBreaks && prevEnd !== null && startMin - prevEnd >= CONFIG.BREAK_THRESHOLD_MIN) {
            const isLunch = startMin >= CONFIG.LUNCH_START && prevEnd <= CONFIG.LUNCH_END;
            timeline.insertAdjacentHTML('beforeend', `
                <li class="tl-break">
                    <span class="tl-break-line"></span>
                    <span class="tl-break-label">${isLunch ? `${ICONS.coffee}Lunch break` : 'Break'} · ${minutesToLabel(startMin - prevEnd)}</span>
                    <span class="tl-break-line"></span>
                </li>`);
        }

        const badge = hl
            ? { cls: 'status-next', label: dayStatus === 'future' ? 'First class' : (status === 'current' ? 'In progress' : 'Next') }
            : { cls: `status-${status}`, label: { completed: 'Done', current: 'In progress', upcoming: 'Upcoming' }[status] };

        const live = dayStatus === 'today' && hl ? `
            <div class="tl-countdown">${ICONS.clock}<span>${status === 'current'
                ? `${naturalDur(endMin - nowMin)} remaining`
                : `Starts in ${naturalDur(startMin - nowMin)}`}</span></div>` : '';
        const progress = dayStatus === 'today' && hl && status === 'current' ? `
            <div class="progress-wrap">
                <div class="progress-track"><div class="progress-fill" style="width:${Math.min(100, Math.max(0, ((nowMin - startMin) / (endMin - startMin)) * 100))}%"></div></div>
                <div class="progress-meta">
                    <span class="progress-elapsed">${minutesToClock(startMin)}</span>
                    <span class="progress-remaining">${minutesToClock(endMin)}</span>
                </div>
            </div>` : '';

        const item = document.createElement('li');
        item.className = `tl-item ${status}${hl ? ' highlight' : ''}`;
        item.innerHTML = `
            <div class="tl-marker"></div>
            <div class="tl-card">
                <div class="tl-card-top">
                    <div>
                        <div class="tl-subject">${escapeHtml(c.subject)}</div>
                        <div class="tl-meta">
                            ${c.faculty ? `<span class="tl-faculty">${escapeHtml(c.faculty)}</span>` : ''}
                            <span class="tl-room">${ICONS.mapPin}<span>${escapeHtml(c.room || 'Room TBA')}</span></span>
                        </div>
                    </div>
                    <span class="status-badge ${badge.cls}">${badge.label}</span>
                </div>
                ${c.roomChanged ? `<span class="room-change-badge">${ICONS.alertTriangle}<span>${c.originalRoom ? `Room changed · ${escapeHtml(c.originalRoom)} → ${escapeHtml(c.room)}` : 'Room changed'}</span></span>` : ''}
                ${live}
                ${progress}
                <div class="tl-time-row">
                    <span>${minutesToClock(startMin)} – ${minutesToClock(endMin)}</span>
                    <span class="tl-duration">${minutesToLabel(endMin - startMin)}</span>
                </div>
            </div>`;
        timeline.appendChild(item);
        prevEnd = endMin;
    }
}

// Shared empty/error card. renderEmpty resets it to the default state so a
// previous error can never leave stale text behind.
function hideAll() {
    $('#schedule-section')?.classList.add('hidden');
}

export function renderEmpty() {
    hideLoading();
    hideAll();
    $('.state-card').classList.remove('hidden');
    $('#empty-icon').innerHTML = ICONS.calendarX;
    $('#state-title').textContent = 'No classes found';
    $('#state-message').textContent = 'There are no classes scheduled for this day.';
    $('.retry-btn').classList.add('hidden');
}

export function renderError() {
    hideLoading();
    hideAll();
    $('.state-card').classList.remove('hidden');
    $('#empty-icon').innerHTML = ICONS.circleAlert;
    $('#state-title').textContent = "Couldn't load the timetable";
    $('#state-message').textContent = 'Check your connection and try again. Your last known schedule is still cached offline.';
    $('.retry-btn').classList.remove('hidden');
}

export function renderSuccess() {
    hideLoading();
    $('.state-card').classList.add('hidden');
    $('.retry-btn').classList.add('hidden');
}

export function setLastUpdated(date) {
    $('.last-updated').textContent = `Last updated ${date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
}

export function showToast(message) {
    const toast = $('.toast');
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => {
        toast.classList.remove('show');
        toast.textContent = '';
    }, 3000);
}

export function setRefreshSpinning(on) {
    $('#refresh-btn').classList.toggle('spinning', on);
}

export function showSectionModal(sections, onSelect) {
    const modal = $('#section-modal');
    if (!modal) return;
    const options = $('#section-modal-options');
    options.innerHTML = '';
    const sorted = [...new Set(sections)].sort((a, b) => a - b);
    for (const s of sorted) {
        const btn = document.createElement('button');
        btn.className = 'section-option';
        btn.textContent = `Section ${s}`;
        btn.addEventListener('click', () => {
            hideSectionModal();
            onSelect(s);
        });
        options.appendChild(btn);
    }
    modal.classList.remove('hidden');
    requestAnimationFrame(() => {
        modal.classList.add('show');
        const first = options.querySelector('button');
        if (first) first.focus();
    });
}

export function hideSectionModal() {
    const modal = $('#section-modal');
    if (!modal) return;
    modal.classList.remove('show');
    modal.classList.add('hidden');
}
