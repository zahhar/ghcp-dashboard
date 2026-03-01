let globalUsers = [];
let currentSortColumn = 'code_loc_changed';
let currentSortDesc = true;

function formatNumber(num) {
    if (num === null || num === undefined) return '0';
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, "'");
}

let currentMonthFilter = '';

document.addEventListener('DOMContentLoaded', () => {
    fetchDashboardData();
    setupTableSorting();

    document.getElementById('month-filter').addEventListener('change', (e) => {
        currentMonthFilter = e.target.value;
        fetchDashboardData(currentMonthFilter);
    });
});

async function fetchDashboardData(month = '') {
    try {
        const url = month ? `/api/stats?month=${month}` : '/api/stats';
        const response = await fetch(url);

        if (!response.ok) {
            throw new Error('Network response was not ok');
        }

        const data = await response.json();

        // Update header stats
        document.getElementById('stat-total-users').textContent = formatNumber(data.totalUsers);
        document.getElementById('stat-total-interactions').textContent = formatNumber(data.totalInteractions);
        if (data.totalOrgLocChanged !== undefined) {
            document.getElementById('stat-total-loc').textContent = formatNumber(data.totalOrgLocChanged);
        }

        // Populate month dropdown if present in response and not populated yet
        const monthFilterLabel = document.getElementById('month-filter');
        if (data.availableMonths && monthFilterLabel.options.length <= 1) {
            data.availableMonths.forEach(m => {
                const opt = document.createElement('option');
                opt.value = m;
                // Parse YYYY-MM
                const [yyyy, mm] = m.split('-');
                const d = new Date(parseInt(yyyy), parseInt(mm) - 1, 1);
                opt.textContent = d.toLocaleString('default', { month: 'long', year: 'numeric' });
                monthFilterLabel.appendChild(opt);
            });
        }

        globalUsers = data.users || [];

        // Render Tables
        renderUsersTable();

    } catch (error) {
        console.error('Error fetching stats:', error);
        document.getElementById('users-body').innerHTML = `<tr><td colspan="11" class="loading">Failed to load data. Make sure backend is running.</td></tr>`;
    }
}

function getFriendlyDate(dateString) {
    if (!dateString) return '-';
    // dateString format is assumed to be YYYY-MM-DD
    const parts = dateString.split('-');
    if (parts.length !== 3) return dateString;
    const formattedDate = `${parts[2]}.${parts[1]}.${parts[0]}`;

    // Calculate relative string
    const targetDate = new Date(dateString);
    const today = new Date();
    // Normalize to midnight to do purely day-level diffs
    targetDate.setHours(0, 0, 0, 0);
    today.setHours(0, 0, 0, 0);

    const diffTime = today - targetDate;
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

    let relativeStr = '';
    if (diffDays === 0) relativeStr = 'today';
    else if (diffDays === 1) relativeStr = 'yesterday';
    else if (diffDays > 1 && diffDays < 7) relativeStr = `${diffDays} days ago`;
    else if (diffDays >= 7 && diffDays < 14) relativeStr = '1 week ago';
    else if (diffDays >= 14 && diffDays < 30) relativeStr = `${Math.floor(diffDays / 7)} weeks ago`;
    else if (diffDays >= 30) relativeStr = '1+ month ago';
    else relativeStr = 'in the future?';

    return `${formattedDate}<br><span style="font-size:0.8em;color:var(--text-muted)">${relativeStr}</span>`;
}

function setupTableSorting() {
    // Map column index to property names in the user object
    const sortMapping = {
        0: null, // # is not sortable
        1: 'human_name',
        2: 'code_loc_changed',
        3: 'doc_loc_changed',
        4: 'user_initiated_interaction_count',
        5: 'acceptance_rate', // Note: this is a string with '%'
        6: 'favorite_language',
        7: 'favorite_model',
        8: 'favorite_ide',
        9: 'active_days_count',
        10: 'last_active_day'
    };

    const headers = document.querySelectorAll('#users-table th');

    // Store original text
    headers.forEach(th => {
        th.dataset.originalText = th.innerText;
    });

    // Helper to update visual sort indicators
    function updateHeaders() {
        headers.forEach((th, index) => {
            let text = th.dataset.originalText;
            if (sortMapping[index] === currentSortColumn) {
                text += currentSortDesc ? ' ▼' : ' ▲';
            }
            th.innerText = text;
        });
    }

    updateHeaders(); // initial state

    headers.forEach((th, index) => {
        th.style.cursor = 'pointer';
        th.title = "Click to sort";
        th.addEventListener('click', () => {
            const prop = sortMapping[index];
            if (!prop) return;

            // Toggle sort direction if clicking same column
            if (currentSortColumn === prop) {
                currentSortDesc = !currentSortDesc;
            } else {
                currentSortColumn = prop;
                // Default to descending for numbers, ascending for strings (human_name)
                currentSortDesc = prop !== 'human_name';
            }

            updateHeaders();
            renderUsersTable();
        });
    });
}

function renderUsersTable() {
    const tbody = document.getElementById('users-body');
    tbody.innerHTML = '';

    // Sort logic
    let sortedUsers = [...globalUsers];
    if (currentSortColumn !== 'rank') {
        sortedUsers.sort((a, b) => {
            let valA = a[currentSortColumn];
            let valB = b[currentSortColumn];

            // Parse acceptance rate strings back to numbers if needed
            if (currentSortColumn === 'acceptance_rate') {
                valA = parseFloat(valA) || 0;
                valB = parseFloat(valB) || 0;
            }

            // string vs number comparisons
            if (typeof valA === 'string' && typeof valB === 'string') {
                const cmp = valA.localeCompare(valB);
                return currentSortDesc ? -cmp : cmp;
            }

            // Default number / object comparison
            if (valA < valB) return currentSortDesc ? 1 : -1;
            if (valA > valB) return currentSortDesc ? -1 : 1;
            return 0;
        });
    }

    sortedUsers.forEach((user, idx) => {
        const lineNumber = idx + 1;
        const tr = document.createElement('tr');

        if (user.revoked) {
            tr.classList.add('revoked-user');
        }

        const revokedMark = user.revoked ? ' <span style="font-size: 0.9em;">❌</span>' : '';

        tr.innerHTML = `
            <td style="text-align: center; color: var(--text-muted); font-size: 0.9em;">
                ${lineNumber}
            </td>
            <td>
                <div class="user-cell" style="white-space: nowrap; flex-direction: column; align-items: flex-start; gap: 0.1rem;">
                    <span style="font-weight: 600;">${user.human_name}${revokedMark}</span>
                    <span style="font-size: 0.8em; color: var(--text-muted); font-weight: 400;">${user.user_login}</span>
                </div>
            </td>
            <td style="white-space: nowrap;">
                ${formatNumber(user.code_loc_changed)}
                <br>
                <span style="font-size:0.8em;color:var(--text-muted)">
                    +${formatNumber(user.code_loc_added)} | -${formatNumber(user.code_loc_deleted)}
                </span>
            </td>
            <td style="white-space: nowrap;">
                ${formatNumber(user.doc_loc_changed)}
                <br>
                <span style="font-size:0.8em;color:var(--text-muted)">
                    +${formatNumber(user.doc_loc_added)} | -${formatNumber(user.doc_loc_deleted)}
                </span>
            </td>
            <td class="metric-high" style="font-size: 1.1em;">${formatNumber(user.user_initiated_interaction_count)}</td>
            <td>${user.acceptance_rate}</td>
            <td style="white-space: nowrap;">${user.favorite_language}</td>
            <td style="white-space: nowrap;">${user.favorite_model}</td>
            <td style="white-space: nowrap;">${user.favorite_ide}</td>
            <td>
                ${user.active_days_count}
                <br>
                <span style="font-size:0.8em;color:var(--text-muted)">
                    🤖 ${user.agent_days_count} | 💬 ${user.chat_days_count}
                </span>
            </td>
            <td style="color:var(--text-muted); font-size: 0.9em; white-space: nowrap;">${getFriendlyDate(user.last_active_day)}</td>
        `;

        // micro-animation for table rows
        tr.style.opacity = '0';
        tr.style.transform = 'translateX(-10px)';
        // Fast animation to not be annoying for large lists
        tr.style.transition = `opacity 0.2s ease, transform 0.2s ease`;

        // add brief delay only on initial load to avoid jank on sorting
        if (idx < 50) {
            tr.style.transitionDelay = `${Math.min(idx * 0.015, 0.5)}s`;
        }

        tbody.appendChild(tr);

        // Trigger reflow
        void tr.offsetWidth;
        tr.style.opacity = '1';
    });
}

