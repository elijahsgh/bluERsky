import './style.css';
import {
  BlueskyClient,
  type FeedName,
  type SkyNotification,
  type SkyPost,
  type StoredAuth,
} from './bluesky.ts';
import { GlassesDisplay, type GlassesScreen, MENU_IDS } from './glasses.ts';

const STORAGE_KEY = 'bluersky_auth_v1';
const DETAIL_VISIBLE_LINES = 6;
const DETAIL_SCROLL_STEP = 2;
const LINE_WRAP_CHARS = 46;

const appRoot = document.querySelector<HTMLDivElement>('#app')!;
appRoot.innerHTML = `
  <div class="wrap">
    <div class="card">
      <h1>BluERSky</h1>
      <p class="sub">Bluesky reader for Even Realities G2 glasses (App Password auth).</p>
    </div>

    <div class="card">
      <div id="status" class="status">Connecting to Even Hub Bridge...</div>
    </div>

    <div id="login-card" class="card">
      <div style="font-size: 13px; margin-bottom: 8px; color: var(--accent);">
        Sign in with a Bluesky App Password
      </div>
      <p class="sub" style="margin-bottom: 10px;">
        Create an App Password in Bluesky: Settings → Privacy and Security → App Passwords.
      </p>
      <form id="login-form" class="form-grid">
        <label>
          Bluesky Handle
          <input id="input-handle" type="text" placeholder="you.bsky.social" autocomplete="username" required />
        </label>
        <label>
          App Password
          <input id="input-password" type="password" placeholder="xxxx-xxxx-xxxx-xxxx" autocomplete="current-password" required />
        </label>
        <label>
          PDS Service URL
          <input id="input-service" type="url" value="https://bsky.social" required />
        </label>
        <div class="controls" style="margin-top: 4px;">
          <button type="submit" class="primary">Sign In</button>
        </div>
      </form>
      <div id="login-error" class="error hidden"></div>
    </div>

    <div id="account-card" class="card hidden">
      <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px;">
        <div>
          <div style="font-size: 13px; color: var(--green);">Signed in as <strong id="signed-handle"></strong></div>
          <div id="feed-summary" class="sub"></div>
        </div>
        <button id="btn-logout" class="danger" type="button">Sign Out</button>
      </div>
    </div>

    <div class="card">
      <div style="font-size: 12px; color: var(--muted); margin-bottom: 8px;">
        Glasses Display Mirror (576×288):
      </div>
      <div id="mirror" class="preview">Initializing...</div>
    </div>

    <div class="card">
      <div style="font-size: 12px; color: var(--muted); margin-bottom: 8px;">
        Test Controls (or use glasses / simulator inputs):
      </div>
      <div class="controls">
        <button id="btn-prev" type="button">↑ Up / Prev</button>
        <button id="btn-next" type="button">↓ Down / Next</button>
        <button id="btn-open" type="button">● Tap (Open/Back)</button>
        <button id="btn-like" type="button">●● 2xTap (Like)</button>
        <button id="btn-repost" type="button">↻ Repost</button>
        <button id="btn-notifications" type="button">🔔 Notifications</button>
        <button id="btn-feed" type="button">⇄ Switch Feed</button>
        <button id="btn-refresh" type="button">⟳ Refresh</button>
        <button id="btn-exit" class="danger" type="button">✕ Exit Glasses</button>
      </div>
    </div>

    <div class="card">
      <div style="font-size: 12px; color: var(--muted); margin-bottom: 6px;">Event Log:</div>
      <ul id="log" class="log"></ul>
    </div>
  </div>
`;

const statusEl = document.getElementById('status')!;
const loginCardEl = document.getElementById('login-card')!;
const accountCardEl = document.getElementById('account-card')!;
const signedHandleEl = document.getElementById('signed-handle')!;
const feedSummaryEl = document.getElementById('feed-summary')!;
const loginFormEl = document.getElementById('login-form') as HTMLFormElement;
const handleInputEl = document.getElementById('input-handle') as HTMLInputElement;
const passwordInputEl = document.getElementById('input-password') as HTMLInputElement;
const serviceInputEl = document.getElementById('input-service') as HTMLInputElement;
const loginErrorEl = document.getElementById('login-error')!;
const mirrorEl = document.getElementById('mirror')!;
const logEl = document.getElementById('log')!;

const state = {
  viewMode: 'feed' as 'feed' | 'notifications',
  feedName: 'Following' as FeedName,
  posts: [] as SkyPost[],
  cursor: undefined as string | undefined,
  index: 0,
  detailMode: false,
  detailScrollOffset: 0,
  notifications: [] as SkyNotification[],
  notifCursor: undefined as string | undefined,
  notifIndex: 0,
  loading: false,
  loadingMore: false,
  toast: '',
};

let toastTimer: number | null = null;
const glasses = new GlassesDisplay();

const bsky = new BlueskyClient((auth) => {
  if (auth) {
    glasses.setStorage(STORAGE_KEY, JSON.stringify(auth)).catch(console.error);
  } else {
    glasses.clearStorage(STORAGE_KEY).catch(console.error);
  }
});

function addLog(msg: string): void {
  const li = document.createElement('li');
  li.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  logEl.prepend(li);
  while (logEl.children.length > 40) {
    logEl.removeChild(logEl.lastChild!);
  }
}

function setToast(msg: string): void {
  state.toast = msg;
  if (toastTimer !== null) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    state.toast = '';
    renderScreen().catch(console.error);
  }, 1800);
}

function wrapLines(text: string, maxWidth = LINE_WRAP_CHARS): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    const trimmed = paragraph.trim();
    if (!trimmed) {
      lines.push('');
      continue;
    }
    const words = trimmed.split(/\s+/);
    let line = '';
    for (const word of words) {
      if (!line) {
        line = word;
      } else if (line.length + 1 + word.length <= maxWidth) {
        line += ' ' + word;
      } else {
        lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

function buildDetailLines(post: SkyPost): string[] {
  const likeMark = post.liked ? '♥*' : '♥';
  const repostMark = post.reposted ? '↻*' : '↻';
  const stats = `${likeMark} ${post.likes}   ${repostMark} ${post.reposts}   💬 ${post.repliesCount}`;

  const lines: string[] = [
    `${post.author} (@${post.handle}) • ${post.time}`,
    ...wrapLines(post.text),
    stats,
  ];

  if (post.replies === null) {
    lines.push('── Loading replies... ──');
  } else if (post.replies.length > 0) {
    lines.push(`── Replies (${post.replies.length}) ──`);
    for (const r of post.replies) {
      lines.push(...wrapLines(`@${r.author} (${r.time}): ${r.text}`));
    }
  } else {
    lines.push('(No replies)');
  }
  return lines;
}

function formatNotificationReason(reason: string): { icon: string; label: string } {
  switch (reason) {
    case 'like':
    case 'like-via-repost':
      return { icon: '♥', label: 'Liked your post' };
    case 'repost':
    case 'repost-via-repost':
      return { icon: '↻', label: 'Reshared your post' };
    case 'reply':
      return { icon: '↳', label: 'Replied to you' };
    case 'mention':
      return { icon: '@', label: 'Mentioned you' };
    case 'quote':
      return { icon: '❝', label: 'Quoted your post' };
    case 'follow':
      return { icon: '+', label: 'Followed you' };
    default:
      return { icon: '•', label: reason };
  }
}

function formatScreenContent(): GlassesScreen {
  if (!bsky.isAuthenticated()) {
    return {
      header: 'BluERSky  |  SIGN IN REQUIRED',
      body: 'Open BluERSky in the Even App on your phone and sign in with your Bluesky handle + App Password.',
      footer: 'Waiting for Bluesky authentication...',
    };
  }

  if (state.viewMode === 'notifications') {
    if (state.loading && state.notifications.length === 0) {
      return {
        header: 'BluERSky  |  NOTIFICATIONS',
        body: 'Loading your notifications...',
        footer: 'Please wait...',
      };
    }

    if (state.notifications.length === 0) {
      return {
        header: 'BluERSky  |  NOTIFICATIONS',
        body: 'No notifications yet.',
        footer: 'Tap: Back to Feed  •  Hold: Menu',
      };
    }

    const notif = state.notifications[state.notifIndex] ?? state.notifications[0];
    const pos = `${state.notifIndex + 1}/${state.notifications.length}`;
    const unreadTag = notif.isRead ? '' : ' [NEW]';
    const header = state.toast
      ? `BluERSky // ${state.toast}`
      : `BluERSky  |  NOTIFS (${pos})${unreadTag}`;

    const { icon, label } = formatNotificationReason(notif.reason);
    const flatText = notif.subjectText.replace(/\s+/g, ' ').trim();
    const snippet =
      flatText.length > 115 ? flatText.slice(0, 112).trimEnd() + '...' : flatText;
    const body = snippet
      ? `${icon} ${notif.author} (@${notif.handle}) • ${notif.time}\n${label}:\n\n"${snippet}"`
      : `${icon} ${notif.author} (@${notif.handle}) • ${notif.time}\n\n${label}`;

    return {
      header,
      body,
      footer: '↑↓ Next/Prev  •  Tap: Back to Feed  •  Hold: Menu',
    };
  }

  if (state.loading && state.posts.length === 0) {
    return {
      header: `BluERSky  |  ${state.feedName.toUpperCase()}`,
      body: 'Loading your Bluesky feed...',
      footer: 'Please wait...',
    };
  }

  if (state.posts.length === 0) {
    return {
      header: `BluERSky  |  ${state.feedName.toUpperCase()}`,
      body: 'No posts found in this feed.',
      footer: 'Hold: Menu to Switch Feed or Refresh',
    };
  }

  const post = state.posts[state.index] ?? state.posts[0];
  const pos = `${state.index + 1}/${state.posts.length}`;
  const likeMark = post.liked ? '♥*' : '♥';
  const repostMark = post.reposted ? '↻*' : '↻';
  const stats = `${likeMark} ${post.likes}   ${repostMark} ${post.reposts}   💬 ${post.repliesCount}`;

  let header = '';
  let body = '';

  if (!state.detailMode) {
    header = state.toast
      ? `BluERSky // ${state.toast}`
      : `BluERSky  |  ${state.feedName.toUpperCase()} (${pos})`;
    const flat = post.text.replace(/\s+/g, ' ').trim();
    const snippet = flat.length > 115 ? flat.slice(0, 112).trimEnd() + '...' : flat;
    body = `${post.author} (@${post.handle}) • ${post.time}\n\n${snippet}\n\n${stats}`;
  } else {
    const allLines = buildDetailLines(post);
    const maxOffset = Math.max(0, allLines.length - DETAIL_VISIBLE_LINES);
    state.detailScrollOffset = Math.min(state.detailScrollOffset, maxOffset);
    const start = state.detailScrollOffset;
    const end = Math.min(allLines.length, start + DETAIL_VISIBLE_LINES);
    const visible = allLines.slice(start, end);

    header = state.toast
      ? `BluERSky // ${state.toast}`
      : `BluERSky | DETAIL (${pos}) Ln ${start + 1}-${end}/${allLines.length}`;
    body = visible.join('\n');
  }

  const footer = state.detailMode
    ? '↑↓ Scroll  •  Tap: Back  •  2xTap: Like  •  Hold: Menu'
    : '↑↓ Post  •  Tap: Open  •  2xTap: Like  •  Hold: Menu';

  return { header, body, footer };
}

async function renderScreen(): Promise<void> {
  const screen = formatScreenContent();
  mirrorEl.textContent = `${screen.header}\n${'─'.repeat(48)}\n${screen.body}\n${'─'.repeat(48)}\n${screen.footer}`;
  await glasses.render(screen);
}

function updateAccountUI(): void {
  if (bsky.isAuthenticated()) {
    loginCardEl.classList.add('hidden');
    accountCardEl.classList.remove('hidden');
    signedHandleEl.textContent = `@${bsky.handle ?? 'unknown'}`;
    feedSummaryEl.textContent =
      state.viewMode === 'notifications'
        ? `Notifications • ${state.notifications.length} loaded`
        : `${state.feedName} feed • ${state.posts.length} posts loaded`;
  } else {
    loginCardEl.classList.remove('hidden');
    accountCardEl.classList.add('hidden');
  }
}

async function loadFeed(): Promise<void> {
  if (!bsky.isAuthenticated()) return;
  state.loading = true;
  state.cursor = undefined;
  await renderScreen();
  try {
    const res = await bsky.fetchFeed(state.feedName, 25);
    state.posts = res.posts;
    state.cursor = res.cursor;
    state.index = 0;
    state.detailMode = false;
    state.detailScrollOffset = 0;
    addLog(`Loaded ${state.posts.length} posts (${state.feedName})`);
  } catch (err) {
    const msg = (err as Error).message;
    addLog(`Feed error: ${msg}`);
    setToast('Feed load error');
  } finally {
    state.loading = false;
    updateAccountUI();
    await renderScreen();
  }
}

async function loadMorePosts(): Promise<void> {
  if (!bsky.isAuthenticated() || state.loadingMore || !state.cursor) return;
  state.loadingMore = true;
  setToast('Loading more...');
  await renderScreen();
  try {
    const res = await bsky.fetchFeed(state.feedName, 25, state.cursor);
    const seen = new Set(state.posts.map((p) => p.uri));
    const fresh = res.posts.filter((p) => !seen.has(p.uri));
    state.posts.push(...fresh);
    state.cursor = res.cursor;
    setToast(`+${fresh.length} posts`);
    addLog(`Loaded ${fresh.length} more posts (total ${state.posts.length})`);
  } catch (err) {
    addLog(`Load more error: ${(err as Error).message}`);
    setToast('Load more failed');
  } finally {
    state.loadingMore = false;
    updateAccountUI();
    await renderScreen();
  }
}

async function loadNotifications(): Promise<void> {
  if (!bsky.isAuthenticated()) return;
  state.viewMode = 'notifications';
  state.detailMode = false;
  state.loading = true;
  state.notifCursor = undefined;
  await renderScreen();
  try {
    const res = await bsky.fetchNotifications(25);
    state.notifications = res.notifications;
    state.notifCursor = res.cursor;
    state.notifIndex = 0;
    addLog(`Loaded ${state.notifications.length} notifications`);
  } catch (err) {
    addLog(`Notifications error: ${(err as Error).message}`);
    setToast('Notif load error');
  } finally {
    state.loading = false;
    updateAccountUI();
    await renderScreen();
  }
}

async function loadMoreNotifications(): Promise<void> {
  if (!bsky.isAuthenticated() || state.loadingMore || !state.notifCursor) return;
  state.loadingMore = true;
  setToast('Loading more...');
  await renderScreen();
  try {
    const res = await bsky.fetchNotifications(25, state.notifCursor);
    const seen = new Set(state.notifications.map((n) => n.uri));
    const fresh = res.notifications.filter((n) => !seen.has(n.uri));
    state.notifications.push(...fresh);
    state.notifCursor = res.cursor;
    setToast(`+${fresh.length} notifs`);
    addLog(`Loaded ${fresh.length} more notifications (total ${state.notifications.length})`);
  } catch (err) {
    addLog(`Load more notifs error: ${(err as Error).message}`);
    setToast('Load more failed');
  } finally {
    state.loadingMore = false;
    updateAccountUI();
    await renderScreen();
  }
}

function scrollDown(): void {
  if (state.viewMode === 'notifications') {
    if (state.notifications.length === 0) return;
    if (state.notifIndex < state.notifications.length - 1) {
      state.notifIndex += 1;
      if (
        state.notifIndex >= state.notifications.length - 3 &&
        state.notifCursor &&
        !state.loadingMore
      ) {
        void loadMoreNotifications();
      } else {
        renderScreen().catch(console.error);
      }
      return;
    }
    if (state.notifCursor) {
      void loadMoreNotifications();
      return;
    }
    state.notifIndex = 0;
    setToast('Top of notifs');
    renderScreen().catch(console.error);
    return;
  }

  if (state.posts.length === 0) return;
  if (state.detailMode) {
    const allLines = buildDetailLines(state.posts[state.index]);
    const maxOffset = Math.max(0, allLines.length - DETAIL_VISIBLE_LINES);
    state.detailScrollOffset = Math.min(maxOffset, state.detailScrollOffset + DETAIL_SCROLL_STEP);
    renderScreen().catch(console.error);
    return;
  }
  if (state.index < state.posts.length - 1) {
    state.index += 1;
    state.detailScrollOffset = 0;
    if (state.index >= state.posts.length - 3 && state.cursor && !state.loadingMore) {
      void loadMorePosts();
    } else {
      renderScreen().catch(console.error);
    }
    return;
  }
  if (state.cursor) {
    void loadMorePosts();
    return;
  }
  state.index = 0;
  state.detailScrollOffset = 0;
  setToast('Top of feed');
  renderScreen().catch(console.error);
}

function scrollUp(): void {
  if (state.viewMode === 'notifications') {
    if (state.notifIndex > 0) {
      state.notifIndex -= 1;
      renderScreen().catch(console.error);
    }
    return;
  }

  if (state.posts.length === 0) return;
  if (state.detailMode) {
    state.detailScrollOffset = Math.max(0, state.detailScrollOffset - DETAIL_SCROLL_STEP);
    renderScreen().catch(console.error);
    return;
  }
  if (state.index > 0) {
    state.index -= 1;
    state.detailScrollOffset = 0;
    renderScreen().catch(console.error);
  }
}

function toggleDetail(): void {
  if (state.viewMode === 'notifications') {
    state.viewMode = 'feed';
    updateAccountUI();
    renderScreen().catch(console.error);
    return;
  }
  if (state.posts.length === 0) return;
  state.detailMode = !state.detailMode;
  state.detailScrollOffset = 0;
  const post = state.posts[state.index];
  if (state.detailMode && post.replies === null) {
    bsky
      .fetchReplies(post)
      .then(() => renderScreen())
      .catch((err) => addLog(`Replies error: ${(err as Error).message}`));
  }
  renderScreen().catch(console.error);
}

async function handleLike(): Promise<void> {
  if (state.posts.length === 0) return;
  const post = state.posts[state.index];
  try {
    const liked = await bsky.toggleLike(post);
    setToast(liked ? 'Liked ♥' : 'Unliked');
    addLog(`${liked ? 'Liked' : 'Unliked'} @${post.handle}`);
    await renderScreen();
  } catch (err) {
    addLog(`Like error: ${(err as Error).message}`);
    setToast('Like failed');
  }
}

async function handleRepost(): Promise<void> {
  if (state.posts.length === 0) return;
  const post = state.posts[state.index];
  try {
    const reposted = await bsky.toggleRepost(post);
    setToast(reposted ? 'Reposted ↻' : 'Undo Repost');
    addLog(`${reposted ? 'Reposted' : 'Un-reposted'} @${post.handle}`);
    await renderScreen();
  } catch (err) {
    addLog(`Repost error: ${(err as Error).message}`);
    setToast('Repost failed');
  }
}

function switchFeed(): void {
  state.viewMode = 'feed';
  state.feedName = state.feedName === 'Following' ? 'Discover' : 'Following';
  setToast(`Feed: ${state.feedName}`);
  loadFeed().catch(console.error);
}

function refreshCurrentView(): void {
  if (state.viewMode === 'notifications') {
    void loadNotifications();
  } else {
    void loadFeed();
  }
}

loginFormEl.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginErrorEl.classList.add('hidden');
  try {
    await bsky.login(serviceInputEl.value, handleInputEl.value, passwordInputEl.value);
    passwordInputEl.value = '';
    addLog(`Signed in as @${bsky.handle}`);
    updateAccountUI();
    await loadFeed();
  } catch (err) {
    loginErrorEl.textContent = `Sign-in failed: ${(err as Error).message}`;
    loginErrorEl.classList.remove('hidden');
  }
});

document.getElementById('btn-logout')!.addEventListener('click', () => {
  bsky.logout();
  state.viewMode = 'feed';
  state.posts = [];
  state.notifications = [];
  state.index = 0;
  state.notifIndex = 0;
  state.detailMode = false;
  updateAccountUI();
  renderScreen().catch(console.error);
  addLog('Signed out');
});

document.getElementById('btn-prev')!.addEventListener('click', scrollUp);
document.getElementById('btn-next')!.addEventListener('click', scrollDown);
document.getElementById('btn-open')!.addEventListener('click', toggleDetail);
document.getElementById('btn-like')!.addEventListener('click', () => void handleLike());
document.getElementById('btn-repost')!.addEventListener('click', () => void handleRepost());
document.getElementById('btn-notifications')!.addEventListener('click', () => void loadNotifications());
document.getElementById('btn-feed')!.addEventListener('click', switchFeed);
document.getElementById('btn-refresh')!.addEventListener('click', refreshCurrentView);
document.getElementById('btn-exit')!.addEventListener('click', () => {
  void glasses.shutDown(0).then(() => {
    statusEl.textContent = 'Glasses page closed.';
    addLog('Closed glasses page via shutDownPageContainer(0)');
  });
});

window.addEventListener('pagehide', () => {
  void glasses.shutDown(0);
});

async function main(): Promise<void> {
  const initialScreen = formatScreenContent();
  mirrorEl.textContent = `${initialScreen.header}\n${'─'.repeat(48)}\n${initialScreen.body}\n${'─'.repeat(48)}\n${initialScreen.footer}`;

  const connected = await glasses.connect(initialScreen, {
    onScrollUp: scrollUp,
    onScrollDown: scrollDown,
    onClick: toggleDetail,
    onDoubleClick: () => {
      if (state.viewMode === 'feed') void handleLike();
    },
    onMenuItem: (itemId) => {
      if (itemId === MENU_IDS.LIKE && state.viewMode === 'feed') void handleLike();
      else if (itemId === MENU_IDS.REPOST && state.viewMode === 'feed') void handleRepost();
      else if (itemId === MENU_IDS.NOTIFICATIONS) void loadNotifications();
      else if (itemId === MENU_IDS.SWITCH_FEED) switchFeed();
      else if (itemId === MENU_IDS.REFRESH) refreshCurrentView();
      else if (itemId === MENU_IDS.EXIT) {
        void glasses.shutDown(0).then(() => {
          statusEl.textContent = 'Glasses page closed.';
          addLog('Closed glasses page via menu Exit App');
        });
      }
    },
    onLog: addLog,
  });

  statusEl.textContent = connected
    ? 'Even Hub Bridge connected!'
    : 'Browser preview mode (Even Hub Bridge not active)';

  const rawSaved = await glasses.getStorage(STORAGE_KEY);
  if (rawSaved) {
    try {
      const saved = JSON.parse(rawSaved) as StoredAuth;
      await bsky.resume(saved);
      addLog(`Resumed session for @${bsky.handle}`);
      updateAccountUI();
      await loadFeed();
      return;
    } catch (err) {
      addLog(`Saved session expired: ${(err as Error).message}`);
      await glasses.clearStorage(STORAGE_KEY);
    }
  }

  updateAccountUI();
  await renderScreen();
}

main().catch((err) => {
  statusEl.textContent = `Startup error: ${(err as Error).message}`;
  addLog(`Startup error: ${(err as Error).message}`);
});
