export type FeedName = 'Following' | 'Discover';

export interface AtpSessionData {
  accessJwt: string;
  refreshJwt: string;
  handle: string;
  did: string;
  active?: boolean;
}

export interface SkyReply {
  author: string;
  time: string;
  text: string;
}

export interface SkyNotification {
  uri: string;
  author: string;
  handle: string;
  reason: string;
  time: string;
  isRead: boolean;
  subjectText: string;
}

export interface SkyPost {
  uri: string;
  cid: string;
  author: string;
  handle: string;
  time: string;
  text: string;
  likes: number;
  reposts: number;
  repliesCount: number;
  liked: boolean;
  likeUri?: string;
  reposted: boolean;
  repostUri?: string;
  replies: SkyReply[] | null;
}

export interface StoredAuth {
  service: string;
  session: AtpSessionData;
}

interface RawAuthor {
  handle: string;
  displayName?: string;
}

interface RawPostView {
  uri: string;
  cid: string;
  author: RawAuthor;
  record?: { text?: string; createdAt?: string };
  indexedAt?: string;
  likeCount?: number;
  repostCount?: number;
  replyCount?: number;
  viewer?: { like?: string; repost?: string };
}

interface RawFeedViewPost {
  post: RawPostView;
}

interface RawThreadViewPost {
  $type?: string;
  post?: RawPostView;
  replies?: RawThreadViewPost[];
}

interface RawNotification {
  uri: string;
  author: RawAuthor;
  reason: string;
  reasonSubject?: string;
  record?: { text?: string };
  isRead: boolean;
  indexedAt?: string;
}

const DEFAULT_SERVICE = 'https://bsky.social';
const DISCOVER_FEED_URI =
  'at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.generator/whats-hot';

export function formatRelativeTime(isoDate?: string): string {
  if (!isoDate) return '';
  const diffSec = Math.max(0, Math.floor((Date.now() - Date.parse(isoDate)) / 1000));
  if (diffSec < 60) return `${diffSec}s`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h`;
  return `${Math.floor(diffHr / 24)}d`;
}

function mapFeedPost(item: RawFeedViewPost): SkyPost {
  const post = item.post;
  const record = post.record ?? {};
  return {
    uri: post.uri,
    cid: post.cid,
    author: post.author.displayName || post.author.handle,
    handle: post.author.handle,
    time: formatRelativeTime(record.createdAt ?? post.indexedAt),
    text: record.text ?? '',
    likes: post.likeCount ?? 0,
    reposts: post.repostCount ?? 0,
    repliesCount: post.replyCount ?? 0,
    liked: Boolean(post.viewer?.like),
    likeUri: post.viewer?.like,
    reposted: Boolean(post.viewer?.repost),
    repostUri: post.viewer?.repost,
    replies: null,
  };
}

function normalizeService(serviceUrl: string): string {
  return (serviceUrl.trim() || DEFAULT_SERVICE).replace(/\/+$/, '');
}

export class BlueskyClient {
  private session: AtpSessionData | null = null;
  private service = DEFAULT_SERVICE;
  private onSessionUpdate?: (auth: StoredAuth | null) => void;

  constructor(onSessionUpdate?: (auth: StoredAuth | null) => void) {
    this.onSessionUpdate = onSessionUpdate;
  }

  private async refreshSession(): Promise<boolean> {
    if (!this.session?.refreshJwt) return false;
    const res = await fetch(`${this.service}/xrpc/com.atproto.server.refreshSession`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.session.refreshJwt}`,
      },
    });
    if (!res.ok) {
      this.session = null;
      this.onSessionUpdate?.(null);
      return false;
    }
    const next = (await res.json()) as AtpSessionData;
    this.session = next;
    this.onSessionUpdate?.({ service: this.service, session: next });
    return true;
  }

  private async xrpc<T>(
    nsid: string,
    options: {
      method?: 'GET' | 'POST';
      params?: URLSearchParams;
      body?: unknown;
      auth?: boolean;
    } = {},
    allowRefresh = true,
  ): Promise<T> {
    const { method = 'GET', params, body, auth = true } = options;
    if (auth && !this.session) {
      throw new Error('Not signed in');
    }

    const query = params && params.toString() ? `?${params.toString()}` : '';
    const headers: Record<string, string> = {};
    if (auth && this.session) {
      headers.Authorization = `Bearer ${this.session.accessJwt}`;
    }
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    const res = await fetch(`${this.service}/xrpc/${nsid}${query}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (res.status === 401 && auth && allowRefresh) {
      const refreshed = await this.refreshSession();
      if (refreshed) {
        return this.xrpc<T>(nsid, options, false);
      }
    }

    if (!res.ok) {
      let detail = `${res.status} ${res.statusText}`;
      try {
        const errJson = (await res.json()) as { message?: string; error?: string };
        if (errJson.message) detail = errJson.message;
        else if (errJson.error) detail = errJson.error;
      } catch {
        // Keep HTTP status text.
      }
      throw new Error(detail);
    }

    if (res.status === 204) return undefined as T;
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  async login(serviceUrl: string, identifier: string, password: string): Promise<StoredAuth> {
    this.service = normalizeService(serviceUrl);
    const session = await this.xrpc<AtpSessionData>(
      'com.atproto.server.createSession',
      {
        method: 'POST',
        auth: false,
        body: {
          identifier: identifier.trim(),
          password: password.trim(),
        },
      },
      false,
    );
    if (!session?.accessJwt) {
      throw new Error('Bluesky login did not return a valid session');
    }
    this.session = session;
    const auth: StoredAuth = { service: this.service, session };
    this.onSessionUpdate?.(auth);
    return auth;
  }

  async resume(stored: StoredAuth): Promise<void> {
    this.service = normalizeService(stored.service);
    this.session = stored.session;
    // Validate session; automatically refreshes if accessJwt expired.
    await this.xrpc<{ did: string; handle: string }>('com.atproto.server.getSession');
  }

  logout(): void {
    this.session = null;
    this.onSessionUpdate?.(null);
  }

  get handle(): string | undefined {
    return this.session?.handle;
  }

  isAuthenticated(): boolean {
    return Boolean(this.session?.accessJwt);
  }

  async fetchFeed(
    feedName: FeedName,
    limit = 25,
    cursor?: string,
  ): Promise<{ posts: SkyPost[]; cursor?: string }> {
    const params = new URLSearchParams();
    params.set('limit', String(limit));
    if (cursor) params.set('cursor', cursor);

    if (feedName === 'Following') {
      const data = await this.xrpc<{ feed: RawFeedViewPost[]; cursor?: string }>(
        'app.bsky.feed.getTimeline',
        { params },
      );
      return {
        posts: (data.feed ?? []).map(mapFeedPost),
        cursor: data.cursor,
      };
    }

    params.set('feed', DISCOVER_FEED_URI);
    const data = await this.xrpc<{ feed: RawFeedViewPost[]; cursor?: string }>(
      'app.bsky.feed.getFeed',
      { params },
    );
    return {
      posts: (data.feed ?? []).map(mapFeedPost),
      cursor: data.cursor,
    };
  }

  async fetchReplies(post: SkyPost): Promise<SkyReply[]> {
    const params = new URLSearchParams({
      uri: post.uri,
      depth: '1',
      parentHeight: '0',
    });
    const data = await this.xrpc<{ thread?: RawThreadViewPost }>('app.bsky.feed.getPostThread', {
      params,
    });
    const thread = data.thread;
    if (!thread?.replies) {
      post.replies = [];
      return [];
    }
    const replies: SkyReply[] = [];
    for (const r of thread.replies) {
      if (!r.post) continue;
      const rec = r.post.record ?? {};
      replies.push({
        author: r.post.author.handle,
        time: formatRelativeTime(rec.createdAt ?? r.post.indexedAt),
        text: rec.text ?? '',
      });
    }
    post.replies = replies;
    return replies;
  }

  async toggleLike(post: SkyPost): Promise<boolean> {
    if (!this.session) throw new Error('Not signed in');
    if (post.liked && post.likeUri) {
      const rkey = post.likeUri.split('/').pop();
      if (rkey) {
        await this.xrpc('com.atproto.repo.deleteRecord', {
          method: 'POST',
          body: {
            repo: this.session.did,
            collection: 'app.bsky.feed.like',
            rkey,
          },
        });
      }
      post.liked = false;
      post.likeUri = undefined;
      post.likes = Math.max(0, post.likes - 1);
      return false;
    }
    const res = await this.xrpc<{ uri: string }>('com.atproto.repo.createRecord', {
      method: 'POST',
      body: {
        repo: this.session.did,
        collection: 'app.bsky.feed.like',
        record: {
          $type: 'app.bsky.feed.like',
          subject: { uri: post.uri, cid: post.cid },
          createdAt: new Date().toISOString(),
        },
      },
    });
    post.liked = true;
    post.likeUri = res.uri;
    post.likes += 1;
    return true;
  }

  async toggleRepost(post: SkyPost): Promise<boolean> {
    if (!this.session) throw new Error('Not signed in');
    if (post.reposted && post.repostUri) {
      const rkey = post.repostUri.split('/').pop();
      if (rkey) {
        await this.xrpc('com.atproto.repo.deleteRecord', {
          method: 'POST',
          body: {
            repo: this.session.did,
            collection: 'app.bsky.feed.repost',
            rkey,
          },
        });
      }
      post.reposted = false;
      post.repostUri = undefined;
      post.reposts = Math.max(0, post.reposts - 1);
      return false;
    }
    const res = await this.xrpc<{ uri: string }>('com.atproto.repo.createRecord', {
      method: 'POST',
      body: {
        repo: this.session.did,
        collection: 'app.bsky.feed.repost',
        record: {
          $type: 'app.bsky.feed.repost',
          subject: { uri: post.uri, cid: post.cid },
          createdAt: new Date().toISOString(),
        },
      },
    });
    post.reposted = true;
    post.repostUri = res.uri;
    post.reposts += 1;
    return true;
  }

  async fetchNotifications(
    limit = 25,
    cursor?: string,
  ): Promise<{ notifications: SkyNotification[]; cursor?: string }> {
    const params = new URLSearchParams();
    params.set('limit', String(limit));
    if (cursor) params.set('cursor', cursor);

    const data = await this.xrpc<{ notifications: RawNotification[]; cursor?: string }>(
      'app.bsky.notification.listNotifications',
      { params },
    );
    const raw = data.notifications ?? [];

    const subjectUris = Array.from(
      new Set(
        raw
          .filter(
            (n) =>
              (n.reason === 'like' ||
                n.reason === 'repost' ||
                n.reason === 'like-via-repost' ||
                n.reason === 'repost-via-repost') &&
              n.reasonSubject?.includes('/app.bsky.feed.post/'),
          )
          .map((n) => n.reasonSubject!),
      ),
    ).slice(0, 25);

    const subjectTextMap = new Map<string, string>();
    if (subjectUris.length > 0) {
      try {
        const postParams = new URLSearchParams();
        for (const u of subjectUris) {
          postParams.append('uris', u);
        }
        const postsData = await this.xrpc<{ posts: RawPostView[] }>('app.bsky.feed.getPosts', {
          params: postParams,
        });
        for (const p of postsData.posts ?? []) {
          if (p.record?.text) {
            subjectTextMap.set(p.uri, p.record.text);
          }
        }
      } catch {
        // Non-fatal: fall back to showing notification without quoted subject text.
      }
    }

    const notifications: SkyNotification[] = raw.map((n) => {
      const textFromRecord = typeof n.record?.text === 'string' ? n.record.text : '';
      const textFromSubject = n.reasonSubject ? (subjectTextMap.get(n.reasonSubject) ?? '') : '';
      return {
        uri: n.uri,
        author: n.author.displayName || n.author.handle,
        handle: n.author.handle,
        reason: n.reason,
        time: formatRelativeTime(n.indexedAt),
        isRead: n.isRead,
        subjectText: textFromRecord || textFromSubject,
      };
    });

    return {
      notifications,
      cursor: data.cursor,
    };
  }
}
