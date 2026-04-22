/* ============================================================
   FlowBoard — Task Manager  |  script.js
   Pure Vanilla JS: Drag & Drop, Local Storage, CRUD, Theme,
   Search/Filter, Analytics, Due Date, Toast Notifications
   ============================================================ */

'use strict';

/* ============================================================
   STATE & CONSTANTS
   ============================================================ */

const STORAGE_KEYS = {
  TASKS: 'flowboard_tasks',
  THEME: 'flowboard_theme',
};

const COLUMNS = ['todo', 'inprogress', 'completed'];

// In-memory state
let state = {
  tasks: [],          // Array of task objects
  draggedId: null,    // ID of the card currently being dragged
  editingId: null,    // ID of the task being edited (null = new task)
  deleteTargetId: null,
  searchQuery: '',
  filterPriority: 'all',
};

/* ============================================================
   TASK SCHEMA
   {
     id: string,
     title: string,
     desc: string,
     priority: 'high' | 'medium' | 'low',
     column: 'todo' | 'inprogress' | 'completed',
     due: string (YYYY-MM-DD) | '',
     createdAt: number (timestamp),
   }
   ============================================================ */

/* ============================================================
   UTILITY FUNCTIONS
   ============================================================ */

/** Generate a unique ID */
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/** Save tasks to localStorage */
function saveTasks() {
  localStorage.setItem(STORAGE_KEYS.TASKS, JSON.stringify(state.tasks));
}

/** Load tasks from localStorage */
function loadTasks() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.TASKS);
    state.tasks = raw ? JSON.parse(raw) : [];
  } catch {
    state.tasks = [];
  }
}

/** Format a YYYY-MM-DD date string to a readable short form */
function formatDate(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Return 'overdue', 'soon' (within 2 days), or '' based on due date */
function dueDateStatus(dateStr) {
  if (!dateStr) return '';
  const today = new Date(); today.setHours(0,0,0,0);
  const due = new Date(dateStr + 'T00:00:00');
  const diff = (due - today) / (1000 * 60 * 60 * 24);
  if (diff < 0) return 'overdue';
  if (diff <= 2) return 'soon';
  return '';
}

/** Escape HTML to prevent XSS */
function escHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/* ============================================================
   THEME
   ============================================================ */

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  document.getElementById('theme-icon').textContent = theme === 'dark' ? '☀' : '☾';
  localStorage.setItem(STORAGE_KEYS.THEME, theme);
}

function initTheme() {
  const saved = localStorage.getItem(STORAGE_KEYS.THEME) || 'dark';
  applyTheme(saved);
}

document.getElementById('theme-toggle').addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme');
  applyTheme(current === 'dark' ? 'light' : 'dark');
});

/* ============================================================
   RENDER
   ============================================================ */

/** Build a task card DOM element */
function buildCard(task) {
  const card = document.createElement('div');
  card.className = 'task-card';
  card.setAttribute('draggable', 'true');
  card.setAttribute('data-id', task.id);
  card.setAttribute('data-priority', task.priority);

  const dueStatus = dueDateStatus(task.due);
  const dueHtml = task.due
    ? `<span class="card-due ${dueStatus}">
        ${dueStatus === 'overdue' ? '⚠' : '📅'} ${formatDate(task.due)}
       </span>`
    : '';

  const descHtml = task.desc
    ? `<p class="card-desc">${escHtml(task.desc)}</p>`
    : '';

  const priorityEmoji = { high: '🔴', medium: '🟡', low: '🟢' }[task.priority] || '';

  card.innerHTML = `
    <div class="card-top">
      <h3 class="card-title">${escHtml(task.title)}</h3>
      <div class="card-actions">
        <button class="card-btn edit" title="Edit task" data-id="${task.id}" aria-label="Edit task">✎</button>
        <button class="card-btn delete" title="Delete task" data-id="${task.id}" aria-label="Delete task">✕</button>
      </div>
    </div>
    ${descHtml}
    <div class="card-footer">
      <span class="priority-badge ${task.priority}">${priorityEmoji} ${task.priority}</span>
      ${dueHtml}
    </div>
  `;

  // Drag events
  card.addEventListener('dragstart', onDragStart);
  card.addEventListener('dragend', onDragEnd);

  // Edit / Delete buttons
  card.querySelector('.card-btn.edit').addEventListener('click', (e) => {
    e.stopPropagation();
    openEditModal(task.id);
  });
  card.querySelector('.card-btn.delete').addEventListener('click', (e) => {
    e.stopPropagation();
    openDeleteConfirm(task.id);
  });

  return card;
}

/** Get filtered tasks for a column */
function getFilteredTasks(column) {
  return state.tasks.filter(t => {
    if (t.column !== column) return false;
    if (state.filterPriority !== 'all' && t.priority !== state.filterPriority) return false;
    if (state.searchQuery) {
      const q = state.searchQuery.toLowerCase();
      if (!t.title.toLowerCase().includes(q) && !t.desc.toLowerCase().includes(q)) return false;
    }
    return true;
  });
}

/** Re-render all columns */
function renderBoard() {
  COLUMNS.forEach(col => {
    const list = document.getElementById(`list-${col}`);
    list.innerHTML = '';

    const tasks = getFilteredTasks(col);

    if (tasks.length === 0) {
      // Show empty state (only when no filter active)
      const empty = document.createElement('div');
      empty.className = 'empty-state visible';
      const isFiltering = state.searchQuery || state.filterPriority !== 'all';
      empty.innerHTML = isFiltering
        ? `<span class="empty-icon">🔍</span><span>No matching tasks</span>`
        : `<span class="empty-icon">${col === 'todo' ? '📝' : col === 'inprogress' ? '🚧' : '✅'}</span>
           <span>No tasks yet</span>`;
      list.appendChild(empty);
    } else {
      tasks.forEach(task => list.appendChild(buildCard(task)));
    }
  });

  updateAnalytics();
}

/** Update counts in header and column badges */
function updateAnalytics() {
  COLUMNS.forEach(col => {
    const total = state.tasks.filter(t => t.column === col).length;
    const badge = document.getElementById(`badge-${col}`);
    if (badge) badge.textContent = total;

    // Header stat counts (unfiltered totals)
    const countEl = document.getElementById(`count-${col}`);
    if (countEl) countEl.textContent = total;
  });
}

/* ============================================================
   MODAL — ADD / EDIT
   ============================================================ */

const modalOverlay = document.getElementById('modal-overlay');
const modalTitle   = document.getElementById('modal-title');
const taskTitle    = document.getElementById('task-title');
const taskDesc     = document.getElementById('task-desc');
const taskPriority = document.getElementById('task-priority');
const taskDue      = document.getElementById('task-due');
const taskId       = document.getElementById('task-id');
const taskColumn   = document.getElementById('task-column');

/** Open modal for creating a new task */
function openAddModal(column) {
  state.editingId = null;
  modalTitle.textContent = 'New Task';
  taskTitle.value = '';
  taskDesc.value = '';
  taskPriority.value = 'medium';
  taskDue.value = '';
  taskId.value = '';
  taskColumn.value = column;
  modalOverlay.classList.add('open');
  taskTitle.focus();
}

/** Open modal to edit an existing task */
function openEditModal(id) {
  const task = state.tasks.find(t => t.id === id);
  if (!task) return;
  state.editingId = id;
  modalTitle.textContent = 'Edit Task';
  taskTitle.value = task.title;
  taskDesc.value = task.desc;
  taskPriority.value = task.priority;
  taskDue.value = task.due || '';
  taskId.value = task.id;
  taskColumn.value = task.column;
  modalOverlay.classList.add('open');
  taskTitle.focus();
}

function closeModal() {
  modalOverlay.classList.remove('open');
  state.editingId = null;
}

/** Save task from modal form */
function saveTask() {
  const title = taskTitle.value.trim();
  if (!title) {
    taskTitle.focus();
    taskTitle.style.borderColor = 'var(--priority-high)';
    setTimeout(() => taskTitle.style.borderColor = '', 1200);
    return;
  }

  if (state.editingId) {
    // Update existing
    const idx = state.tasks.findIndex(t => t.id === state.editingId);
    if (idx !== -1) {
      state.tasks[idx] = {
        ...state.tasks[idx],
        title,
        desc: taskDesc.value.trim(),
        priority: taskPriority.value,
        due: taskDue.value,
      };
      showToast('✏️', 'Task updated!');
    }
  } else {
    // Create new
    const newTask = {
      id: uid(),
      title,
      desc: taskDesc.value.trim(),
      priority: taskPriority.value,
      column: taskColumn.value,
      due: taskDue.value,
      createdAt: Date.now(),
    };
    state.tasks.push(newTask);
    showToast('✅', 'Task created!');
  }

  saveTasks();
  renderBoard();
  closeModal();
}

// Modal event listeners
document.getElementById('modal-save').addEventListener('click', saveTask);
document.getElementById('modal-cancel').addEventListener('click', closeModal);
document.getElementById('modal-close').addEventListener('click', closeModal);

// Close on overlay click
modalOverlay.addEventListener('click', (e) => {
  if (e.target === modalOverlay) closeModal();
});

// Enter key in title
taskTitle.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') saveTask();
});

// Add task buttons (on columns)
document.querySelectorAll('.add-btn').forEach(btn => {
  btn.addEventListener('click', () => openAddModal(btn.dataset.column));
});

/* ============================================================
   DELETE CONFIRM DIALOG
   ============================================================ */

const deleteOverlay = document.getElementById('delete-overlay');

function openDeleteConfirm(id) {
  state.deleteTargetId = id;
  deleteOverlay.classList.add('open');
}
function closeDeleteModal() {
  deleteOverlay.classList.remove('open');
  state.deleteTargetId = null;
}

document.getElementById('delete-confirm').addEventListener('click', () => {
  if (!state.deleteTargetId) return;
  state.tasks = state.tasks.filter(t => t.id !== state.deleteTargetId);
  saveTasks();
  renderBoard();
  closeDeleteModal();
  showToast('🗑️', 'Task deleted');
});
document.getElementById('delete-cancel').addEventListener('click', closeDeleteModal);
document.getElementById('delete-close').addEventListener('click', closeDeleteModal);
deleteOverlay.addEventListener('click', (e) => {
  if (e.target === deleteOverlay) closeDeleteModal();
});

/* ============================================================
   DRAG AND DROP
   ============================================================ */

let placeholder = null; // Visual drop placeholder element

function onDragStart(e) {
  state.draggedId = e.currentTarget.dataset.id;
  e.currentTarget.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', state.draggedId);

  // Create placeholder
  placeholder = document.createElement('div');
  placeholder.className = 'drag-placeholder';
  placeholder.style.height = e.currentTarget.offsetHeight + 'px';

  setTimeout(() => {
    e.currentTarget.classList.add('dragging');
  }, 0);
}

function onDragEnd(e) {
  e.currentTarget.classList.remove('dragging');
  state.draggedId = null;
  if (placeholder && placeholder.parentNode) {
    placeholder.parentNode.removeChild(placeholder);
  }
  placeholder = null;
  // Remove any drag-over highlights
  document.querySelectorAll('.task-list').forEach(l => l.classList.remove('drag-over-list'));
  document.querySelectorAll('.column').forEach(c => c.classList.remove('drag-over'));
}

/** Setup drop zone events on a task list */
function setupDropZone(list) {
  list.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    const col = list.closest('.column');
    col.classList.add('drag-over');
    list.classList.add('drag-over-list');

    // Insert placeholder at the right position
    const afterElement = getDragAfterElement(list, e.clientY);
    if (placeholder) {
      if (afterElement == null) {
        list.appendChild(placeholder);
      } else {
        list.insertBefore(placeholder, afterElement);
      }
    }
  });

  list.addEventListener('dragleave', (e) => {
    // Only fire if truly leaving the list (not entering a child)
    if (!list.contains(e.relatedTarget)) {
      list.closest('.column').classList.remove('drag-over');
      list.classList.remove('drag-over-list');
    }
  });

  list.addEventListener('drop', (e) => {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain') || state.draggedId;
    if (!id) return;

    const newColumn = list.dataset.column;
    const task = state.tasks.find(t => t.id === id);
    if (!task) return;

    const oldColumn = task.column;
    task.column = newColumn;

    // Re-order: find where placeholder is among cards
    const cardEls = [...list.querySelectorAll('.task-card')];
    const placeholderIndex = placeholder
      ? [...list.children].indexOf(placeholder)
      : cardEls.length;

    // Remove from tasks array and re-insert at new position
    state.tasks = state.tasks.filter(t => t.id !== id);
    const columnTasks = state.tasks.filter(t => t.column === newColumn);
    const otherTasks  = state.tasks.filter(t => t.column !== newColumn);

    // Determine insertion index among column tasks
    const insertIdx = Math.min(placeholderIndex, columnTasks.length);
    columnTasks.splice(insertIdx, 0, task);
    state.tasks = [...otherTasks, ...columnTasks];

    saveTasks();
    renderBoard();

    if (oldColumn !== newColumn) {
      const colNames = { todo: 'To Do', inprogress: 'In Progress', completed: 'Completed' };
      showToast('🔀', `Moved to ${colNames[newColumn]}`);
    }

    list.closest('.column').classList.remove('drag-over');
    list.classList.remove('drag-over-list');
  });
}

/** Return the element a dragged card should be placed before at clientY */
function getDragAfterElement(list, y) {
  const draggableEls = [...list.querySelectorAll('.task-card:not(.dragging)')];
  return draggableEls.reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) {
      return { offset, element: child };
    }
    return closest;
  }, { offset: Number.NEGATIVE_INFINITY }).element;
}

// Setup drop zones
COLUMNS.forEach(col => {
  const list = document.getElementById(`list-${col}`);
  setupDropZone(list);
});

/* ============================================================
   SEARCH & FILTER
   ============================================================ */

const searchInput = document.getElementById('search-input');
const priorityFilter = document.getElementById('priority-filter');

searchInput.addEventListener('input', () => {
  state.searchQuery = searchInput.value.trim();
  renderBoard();
});

priorityFilter.addEventListener('change', () => {
  state.filterPriority = priorityFilter.value;
  renderBoard();
});

/* ============================================================
   TOAST NOTIFICATION
   ============================================================ */

// Create toast container
const toastContainer = document.createElement('div');
toastContainer.className = 'toast-container';
document.body.appendChild(toastContainer);

function showToast(icon, text, duration = 2600) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `<span class="toast-icon">${icon}</span><span class="toast-text">${text}</span>`;
  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('toast-out');
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
  }, duration);
}

/* ============================================================
   KEYBOARD SHORTCUTS
   ============================================================ */

document.addEventListener('keydown', (e) => {
  // Escape closes any open modal
  if (e.key === 'Escape') {
    if (modalOverlay.classList.contains('open')) closeModal();
    if (deleteOverlay.classList.contains('open')) closeDeleteModal();
  }
});

/* ============================================================
   INIT
   ============================================================ */

function init() {
  initTheme();
  loadTasks();

  // Seed demo tasks if empty (first run)
  if (state.tasks.length === 0) {
    const today = new Date();
    const fmt = d => d.toISOString().slice(0, 10);
    const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
    const nextWeek = new Date(today); nextWeek.setDate(today.getDate() + 6);
    const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);

    state.tasks = [
      {
        id: uid(), title: 'Design landing page', column: 'todo',
        desc: 'Create wireframes and hi-fi mockups for the new homepage.',
        priority: 'high', due: fmt(nextWeek), createdAt: Date.now() - 5000,
      },
      {
        id: uid(), title: 'Set up CI/CD pipeline', column: 'todo',
        desc: 'Configure GitHub Actions for automated tests and deploys.',
        priority: 'medium', due: '', createdAt: Date.now() - 4000,
      },
      {
        id: uid(), title: 'Write unit tests', column: 'todo',
        desc: '', priority: 'low', due: '', createdAt: Date.now() - 3000,
      },
      {
        id: uid(), title: 'Implement auth flow', column: 'inprogress',
        desc: 'OAuth2 + JWT tokens with refresh logic.',
        priority: 'high', due: fmt(tomorrow), createdAt: Date.now() - 2000,
      },
      {
        id: uid(), title: 'Refactor API layer', column: 'inprogress',
        desc: 'Extract data-fetching into a service layer.',
        priority: 'medium', due: fmt(yesterday), createdAt: Date.now() - 1500,
      },
      {
        id: uid(), title: 'Update project README', column: 'completed',
        desc: 'Added setup instructions and screenshots.',
        priority: 'low', due: '', createdAt: Date.now() - 1000,
      },
      {
        id: uid(), title: 'Code review — PR #42', column: 'completed',
        desc: '', priority: 'medium', due: '', createdAt: Date.now() - 500,
      },
    ];
    saveTasks();
  }

  renderBoard();
}

init();