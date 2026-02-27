document.addEventListener('DOMContentLoaded', () => {
    fetchDashboardData();
});

async function fetchDashboardData() {
    try {
        const response = await fetch('/api/stats');

        if (!response.ok) {
            throw new Error('Network response was not ok');
        }

        const data = await response.json();

        // Update header stats
        document.getElementById('stat-total-users').textContent = data.totalUsers.toLocaleString();
        document.getElementById('stat-total-interactions').textContent = data.totalInteractions.toLocaleString();

        // Render Tables
        renderUsersTable(data.users || []);

    } catch (error) {
        console.error('Error fetching stats:', error);
        document.getElementById('users-body').innerHTML = `<tr><td colspan="10" class="loading">Failed to load data. Make sure backend is running.</td></tr>`;
    }
}

function renderUsersTable(users) {
    const tbody = document.getElementById('users-body');
    tbody.innerHTML = '';

    users.forEach((user, index) => {
        const tr = document.createElement('tr');

        let rankClass = 'rank-fame';
        let rankIcon = index + 1;
        if (index === 0) rankIcon = '🥇';
        else if (index === 1) rankIcon = '🥈';
        else if (index === 2) rankIcon = '🥉';
        else rankClass = ''; // no specific fame background

        // Apply class just for sizing/centering if needed, but remove 'rank-fame' green styling
        const rankSpanClass = index <= 2 ? `rank-badge ${rankClass}` : `rank-badge`;

        tr.innerHTML = `
            <td>
                <span class="${rankSpanClass}">${rankIcon}</span>
            </td>
            <td>
                <span class="user-cell" style="white-space: nowrap;">${user.user_login}</span>
            </td>
            <td class="metric-high">${user.user_initiated_interaction_count.toLocaleString()}</td>
            <td>${user.loc_added_sum.toLocaleString()}</td>
            <td>${user.loc_deleted_sum.toLocaleString()}</td>
            <td>${user.acceptance_rate}</td>
            <td style="white-space: nowrap;">${user.favorite_model}</td>
            <td style="white-space: nowrap;">${user.favorite_ide}</td>
            <td>${user.active_days_count}</td>
            <td>${user.agent_chat_days_count}</td>
        `;

        // micro-animation for table rows
        tr.style.opacity = '0';
        tr.style.transform = 'translateX(-10px)';
        // Fast animation to not be annoying for large lists
        tr.style.transition = `all 0.2s ease ${Math.min(index * 0.015, 0.5)}s`;

        tbody.appendChild(tr);

        // Trigger reflow
        void tr.offsetWidth;
        tr.style.opacity = '1';
        tr.style.transform = 'translateX(0)';
    });
}
