/**
 * Main JS Entrypoint - Links all modules and sets up event listeners
 */

import { $, showToast, clearLogs } from './ui.js';
import * as api from './api.js';
import * as pageManager from './pageManager.js';
import * as reactManager from './reactManager.js';

// ========= DOM Elements =========
const inputCookie = $('#inputCookie');
const inputPageName = $('#inputPageName');
const inputPageBio = $('#inputPageBio');
const inputCategory = $('#inputCategory');

const btnCreatePage = $('#btnCreatePage');
const btnSaveConfig = $('#btnSaveConfig');
const btnClearConfig = $('#btnClearConfig');
const btnClearLog = $('#btnClearLog');
const btnOpenSettings = $('#btnOpenSettings');
const btnCloseSettings = $('#btnCloseSettings');
const settingsModal = $('#settingsModal');
const modalOverlay = $('#modalOverlay');

const logEmpty = $('#logEmpty');
const logTableWrap = $('#logTableWrap');
const logTableBody = $('#logTableBody');
const statTotal = $('#statTotal');
const statSuccess = $('#statSuccess');
const statFail = $('#statFail');

const btnRefreshPages = $('#btnRefreshPages');
const pagesListLoading = $('#pagesListLoading');
const pagesListEmpty = $('#pagesListEmpty');
const pagesList = $('#pagesList');

const centralPagesList = $('#centralPagesList');
const centralPagesListLoading = $('#centralPagesListLoading');
const centralPagesListEmpty = $('#centralPagesListEmpty');
const centralPagesTableWrap = $('#centralPagesTableWrap');
const centralPagesCount = $('#centralPagesCount');
const inputSearchPage = $('#inputSearchPage');

const btnStartReact = $('#btnStartReact');
const inputPostUrl = $('#inputPostUrl');
const selectReaction = $('#selectReaction');
const inputReactCount = $('#inputReactCount');
const statReactTotal = $('#statReactTotal');
const statReactSuccess = $('#statReactSuccess');
const statReactFail = $('#statReactFail');
const reactProgressBox = $('#reactProgressBox');
const reactProgressLog = $('#reactProgressLog');

// ========= State =========
const stats = { total: 0, success: 0, fail: 0 };
let isCreating = false;
let isReacting = false;

// ========= DOM Groupings for Modules =========
const sidebarElements = { 
  pagesList, 
  pagesListLoading, 
  pagesListEmpty,
  centralPagesList,
  centralPagesListLoading,
  centralPagesListEmpty,
  centralPagesTableWrap,
  centralPagesCount
};
const uiStatsElements = { statTotal, statSuccess, statFail };
const uiLogsElements = { logEmpty, logTableWrap, logTableBody };
const creationElements = { btnCreatePage };
const pageInputs = { inputPageName, inputPageBio, inputCategory };

const reactionInputs = { inputPostUrl, selectReaction, inputReactCount };
const reactionElements = {
  btnStartReact,
  statReactTotal,
  statReactSuccess,
  statReactFail,
  reactProgressBox,
  reactProgressLog
};

// ========= Settings Modal Toggle =========
const openSettings = () => {
  if (settingsModal) settingsModal.classList.add('active');
};
const closeSettings = () => {
  if (settingsModal) settingsModal.classList.remove('active');
};

if (btnOpenSettings) btnOpenSettings.addEventListener('click', openSettings);
if (btnCloseSettings) btnCloseSettings.addEventListener('click', closeSettings);
if (modalOverlay) modalOverlay.addEventListener('click', closeSettings);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeSettings();
});

// ========= Mobile Drawer Toggle =========
const btnToggleLeftSidebar = $('#btnToggleLeftSidebar');
const btnToggleRightSidebar = $('#btnToggleRightSidebar');
const leftSidebar = $('#leftSidebar');
const rightSidebar = $('#rightSidebar');
const sidebarOverlay = $('#sidebarOverlay');

const closeMobileSidebars = () => {
  if (leftSidebar) {
    leftSidebar.classList.add('-translate-x-full');
    leftSidebar.classList.remove('translate-x-0');
  }
  if (rightSidebar) {
    rightSidebar.classList.add('translate-x-full');
    rightSidebar.classList.remove('translate-x-0');
  }
  if (sidebarOverlay) {
    sidebarOverlay.classList.add('hidden');
  }
};

if (btnToggleLeftSidebar && leftSidebar) {
  btnToggleLeftSidebar.addEventListener('click', (e) => {
    e.stopPropagation();
    leftSidebar.classList.toggle('-translate-x-full');
    leftSidebar.classList.toggle('translate-x-0');
    
    // Close other sidebar
    if (rightSidebar) {
      rightSidebar.classList.add('translate-x-full');
      rightSidebar.classList.remove('translate-x-0');
    }
    
    const isOpen = leftSidebar.classList.contains('translate-x-0');
    if (sidebarOverlay) {
      if (isOpen) sidebarOverlay.classList.remove('hidden');
      else sidebarOverlay.classList.add('hidden');
    }
  });
}

if (btnToggleRightSidebar && rightSidebar) {
  btnToggleRightSidebar.addEventListener('click', (e) => {
    e.stopPropagation();
    rightSidebar.classList.toggle('translate-x-full');
    rightSidebar.classList.toggle('translate-x-0');
    
    // Close other sidebar
    if (leftSidebar) {
      leftSidebar.classList.add('-translate-x-full');
      leftSidebar.classList.remove('translate-x-0');
    }
    
    const isOpen = rightSidebar.classList.contains('translate-x-0');
    if (sidebarOverlay) {
      if (isOpen) sidebarOverlay.classList.remove('hidden');
      else sidebarOverlay.classList.add('hidden');
    }
  });
}

if (sidebarOverlay) {
  sidebarOverlay.addEventListener('click', closeMobileSidebars);
}

// ========= Profile Dropdown Toggle =========
const btnProfileToggle = $('#btnProfileToggle');
const profileDropdownMenu = $('#profileDropdownMenu');
const dropdownArrow = $('#dropdownArrow');

if (btnProfileToggle && profileDropdownMenu) {
  btnProfileToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    profileDropdownMenu.classList.toggle('hidden');
    if (dropdownArrow) {
      const isHidden = profileDropdownMenu.classList.contains('hidden');
      dropdownArrow.style.transform = isHidden ? 'rotate(0deg)' : 'rotate(180deg)';
    }
  });

  document.addEventListener('click', () => {
    profileDropdownMenu.classList.add('hidden');
    if (dropdownArrow) dropdownArrow.style.transform = 'rotate(0deg)';
  });
}

// ========= Tab Switch in Settings Modal =========
const tabModeCookie = $('#tabModeCookie');
const tabModeLogin = $('#tabModeLogin');
const panelModeCookie = $('#panelModeCookie');
const panelModeLogin = $('#panelModeLogin');

if (tabModeCookie && tabModeLogin && panelModeCookie && panelModeLogin) {
  tabModeCookie.addEventListener('click', () => {
    panelModeCookie.classList.remove('hidden');
    panelModeLogin.classList.add('hidden');
    tabModeCookie.className = 'flex-1 pb-2 text-label-md font-bold text-primary border-b-2 border-primary bg-transparent border-none cursor-pointer text-center outline-none';
    tabModeLogin.className = 'flex-1 pb-2 text-label-md font-bold text-on-surface-variant hover:text-on-surface bg-transparent border-none cursor-pointer text-center outline-none';
  });

  tabModeLogin.addEventListener('click', () => {
    panelModeCookie.classList.add('hidden');
    panelModeLogin.classList.remove('hidden');
    tabModeLogin.className = 'flex-1 pb-2 text-label-md font-bold text-primary border-b-2 border-primary bg-transparent border-none cursor-pointer text-center outline-none';
    tabModeCookie.className = 'flex-1 pb-2 text-label-md font-bold text-on-surface-variant hover:text-on-surface bg-transparent border-none cursor-pointer text-center outline-none';
  });
}

// ========= Auto Facebook Login Submit =========
const btnSubmitFbLogin = $('#btnSubmitFbLogin');
const inputFbUsername = $('#inputFbUsername');
const inputFbPassword = $('#inputFbPassword');
const inputFb2FA = $('#inputFb2FA');
const spinnerFbLogin = $('#spinnerFbLogin');

if (btnSubmitFbLogin) {
  btnSubmitFbLogin.addEventListener('click', async () => {
    const username = inputFbUsername.value.trim();
    const password = inputFbPassword.value.trim();
    const twoFactorSecret = inputFb2FA.value.trim();

    if (!username || !password) {
      showToast('Vui lòng điền tài khoản và mật khẩu Facebook!', 'error');
      return;
    }

    btnSubmitFbLogin.disabled = true;
    if (spinnerFbLogin) spinnerFbLogin.classList.remove('hidden');
    showToast('Đang tiến hành đăng nhập và trích xuất cookie (có thể mất 15-30s)...', 'info');

    try {
      const response = await fetch('/api/config/fb-login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('jwt_token')}`
        },
        body: JSON.stringify({ username, password, twoFactorSecret })
      });
      const result = await response.json();

      if (result.success && result.cookie) {
        showToast('Đăng nhập thành công! Đã tự động lấy và lưu Cookie.', 'success');
        if (inputCookie) inputCookie.value = result.cookie;
        
        // Refresh pages list & close
        pageManager.loadPages(inputCookie, sidebarElements);
        closeSettings();
        
        // Clear fields
        inputFbUsername.value = '';
        inputFbPassword.value = '';
        inputFb2FA.value = '';
      } else {
        showToast(result.error || 'Đăng nhập Facebook thất bại.', 'error');
      }
    } catch (err) {
      showToast('Lỗi kết nối máy chủ khi đăng nhập Facebook!', 'error');
    } finally {
      btnSubmitFbLogin.disabled = false;
      if (spinnerFbLogin) spinnerFbLogin.classList.add('hidden');
    }
  });
}

// ========= Save/Load Config (Cookie) =========
if (btnSaveConfig) {
  btnSaveConfig.addEventListener('click', async () => {
    const cookie = inputCookie.value.trim();
    if (cookie) {
      try {
        const result = await api.saveConfig(cookie);
        if (result.success) {
          showToast('Đã lưu cookie vào file cấu hình!', 'success');
          closeSettings();
          pageManager.loadPages(inputCookie, sidebarElements);
        } else {
          showToast('Lỗi lưu cấu hình!', 'error');
        }
      } catch (e) {
        showToast('Lỗi kết nối server!', 'error');
      }
    } else {
      showToast('Cookie trống!', 'error');
    }
  });
}

if (btnClearConfig) {
  btnClearConfig.addEventListener('click', async () => {
    try {
      const result = await api.saveConfig('');
      if (result.success) {
        inputCookie.value = '';
        showToast('Đã xoá cookie', 'success');
        closeSettings();
        if (pagesList) {
          pagesList.innerHTML = '';
          pagesList.style.display = 'none';
        }
        if (pagesListEmpty) pagesListEmpty.style.display = 'flex';
      }
    } catch (e) {
      showToast('Lỗi kết nối server!', 'error');
    }
  });
}

// ========= Create Page Event =========
if (btnCreatePage) {
  btnCreatePage.addEventListener('click', async () => {
    if (isCreating) return;
    isCreating = true;
    await pageManager.createNewPage(
      inputCookie,
      pageInputs,
      creationElements,
      stats,
      { ...uiStatsElements, ...uiLogsElements }
    );
    isCreating = false;
    // Auto refresh page lists
    pageManager.loadPages(inputCookie, sidebarElements);
  });
}

// ========= Bulk React Event =========
if (btnStartReact) {
  btnStartReact.addEventListener('click', async () => {
    if (isReacting) return;
    isReacting = true;
    await reactManager.startReact(
      inputCookie,
      reactionInputs,
      reactionElements,
      openSettings
    );
    isReacting = false;
  });
}

// ========= Sidebar Refresh Event =========
if (btnRefreshPages) {
  btnRefreshPages.addEventListener('click', () => {
    pageManager.loadPages(inputCookie, sidebarElements);
  });
}

// ========= Central Page Search Event =========
if (inputSearchPage) {
  inputSearchPage.addEventListener('input', () => {
    const query = inputSearchPage.value.trim().toLowerCase();
    if (!window.cachedPages) return;

    const filtered = window.cachedPages.filter(page => {
      return (page.name && page.name.toLowerCase().includes(query)) || (page.id && page.id.toLowerCase().includes(query));
    });
    
    pageManager.renderCentralPages(filtered, sidebarElements);
  });
}

// ========= Clear Logs Event =========
if (btnClearLog) {
  btnClearLog.addEventListener('click', () => {
    clearLogs(
      { ...uiLogsElements, ...uiStatsElements },
      stats
    );
  });
}

// ========= DOM Elements for Auth =========
const appContainer = $('#appContainer');
const loginOverlay = $('#loginOverlay');
const loginForm = $('#loginForm');
const loginUsername = $('#loginUsername');
const loginPassword = $('#loginPassword');
const loginError = $('#loginError');
const authTitle = $('#authTitle');

const changePasswordForm = $('#changePasswordForm');
const currentPassword = $('#currentPassword');
const newPassword = $('#newPassword');
const confirmPassword = $('#confirmPassword');
const changePasswordError = $('#changePasswordError');

// ========= Authentication Checks & Handlers =========

function showLoginScreen() {
  loginOverlay.style.display = 'flex';
  loginForm.style.display = 'block';
  if (authTitle) authTitle.textContent = 'đăng nhập';
  loginUsername.value = '';
  loginPassword.value = '';
  loginError.style.display = 'none';
  
  // Clear any data on screen
  inputCookie.value = '';
  pagesList.innerHTML = '';
  pagesList.style.display = 'none';
  pagesListEmpty.style.display = 'flex';

  if (appContainer) appContainer.style.display = 'none';
}

function hideLoginScreen() {
  loginOverlay.style.display = 'none';
  if (appContainer) appContainer.style.display = 'flex';
}

// Handle login submission
loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = loginUsername.value.trim();
  const password = loginPassword.value.trim();
  
  if (!username || !password) {
    loginError.textContent = 'Vui lòng điền đầy đủ tài khoản và mật khẩu.';
    loginError.style.display = 'block';
    return;
  }
  
  try {
    const result = await api.login(username, password);
    if (result.success && result.token) {
      localStorage.setItem('jwt_token', result.token);
      localStorage.setItem('username', username);
      hideLoginScreen();
      showToast('Đăng nhập thành công!', 'success');
      await init();
    } else {
      loginError.textContent = result.error || 'Tài khoản hoặc mật khẩu không chính xác.';
      loginError.style.display = 'block';
    }
  } catch (error) {
    loginError.textContent = 'Lỗi kết nối đến máy chủ.';
    loginError.style.display = 'block';
  }
});

// Handle logout
document.querySelectorAll('.btn-logout-trigger').forEach(btn => {
  btn.addEventListener('click', () => {
    localStorage.removeItem('jwt_token');
    localStorage.removeItem('username');
    showLoginScreen();
    showToast('Đã đăng xuất.', 'success');
  });
});

// Handle change password
changePasswordForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  changePasswordError.style.display = 'none';
  
  const curPass = currentPassword.value;
  const newPass = newPassword.value;
  const confPass = confirmPassword.value;
  
  if (newPass.length < 4) {
    changePasswordError.textContent = 'Mật khẩu mới phải dài tối thiểu 4 ký tự.';
    changePasswordError.style.display = 'block';
    return;
  }
  
  if (newPass !== confPass) {
    changePasswordError.textContent = 'Mật khẩu mới và xác nhận mật khẩu không trùng khớp.';
    changePasswordError.style.display = 'block';
    return;
  }
  
  try {
    const result = await api.changePassword(curPass, newPass);
    if (result.success) {
      showToast('Đổi mật khẩu thành công!', 'success');
      currentPassword.value = '';
      newPassword.value = '';
      confirmPassword.value = '';
      
      // Close the modal settings
      closeSettings();
    } else {
      changePasswordError.textContent = result.error || 'Lỗi đổi mật khẩu.';
      changePasswordError.style.display = 'block';
    }
  } catch (error) {
    changePasswordError.textContent = error.message || 'Lỗi kết nối đến máy chủ.';
    changePasswordError.style.display = 'block';
  }
});

// Listen to JWT expiration/unauthorized events
window.addEventListener('auth-expired', (e) => {
  showLoginScreen();
  showToast('Phiên đăng nhập hết hạn hoặc không hợp lệ. Vui lòng đăng nhập lại.', 'error');
});

// ========= Password Visibility Toggles =========
document.querySelectorAll('.password-input-wrapper').forEach(wrapper => {
  const input = wrapper.querySelector('input');
  const toggleBtn = wrapper.querySelector('.btn-toggle-password');
  const icon = toggleBtn.querySelector('.material-symbols-outlined');

  toggleBtn.addEventListener('click', (e) => {
    e.preventDefault();
    const isPassword = input.type === 'password';
    input.type = isPassword ? 'text' : 'password';
    if (icon) {
      icon.textContent = isPassword ? 'visibility_off' : 'visibility';
    }
    input.focus();
  });
});

// ========= Initialize On Page Load =========
async function init() {
  const token = localStorage.getItem('jwt_token');
  if (!token) {
    showLoginScreen();
    return;
  }
  
  hideLoginScreen();

  // Update welcome text and avatar with logged-in username
  const loggedUsername = localStorage.getItem('username') || 'Admin';
  const headerWelcomeText = $('#headerWelcomeText');
  const headerUserAvatar = $('#headerUserAvatar');
  const dropdownUsernameText = $('#dropdownUsernameText');
  if (headerWelcomeText) headerWelcomeText.textContent = `Xin chào ${loggedUsername}`;
  if (headerUserAvatar) headerUserAvatar.textContent = loggedUsername.charAt(0).toUpperCase();
  if (dropdownUsernameText) dropdownUsernameText.textContent = `Tài khoản: ${loggedUsername}`;

  // Restore persistent logs/stats sessions
  pageManager.restoreCreatorSession(stats, { ...uiStatsElements, ...uiLogsElements });
  reactManager.restoreReactSession(reactionElements);
  
  try {
    const response = await api.fetchConfig();
    if (response.success && response.cookie) {
      if (inputCookie) inputCookie.value = response.cookie;
      pageManager.loadPages(inputCookie, sidebarElements);
    }
  } catch (error) {
    // If it's a 401 error, the event auth-expired will trigger
    console.error('Lỗi khởi tạo cấu hình từ server:', error);
  }
}

init();

