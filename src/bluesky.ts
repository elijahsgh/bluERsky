import { AtpAgent, type AtpSessionData, AppBskyFeedDefs } from '@atproto/api';

export type FeedName = 'Following' | 'Discover';

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

function mapFeedPost(item: AppBskyFeedDefs.FeedViewPost): SkyPost {
  const post = item.post;
  const record = post.record as { text?: string; createdAt?: string };
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

export class BlueskyClient {
  private agent: AtpAgent | null = null;
  private service = 'https://bsky.social';
  private onSessionUpdate?: (auth: StoredAuth | null) => void;

  constructor(onSessionUpdate?: (auth: StoredAuth | null) => void) {
    this.onSessionUpdate = onSessionUpdate;
  }

  private createAgent(serviceUrl: string): AtpAgent {
    this.service = serviceUrl.trim() || 'https://bsky.social';
    return new AtpAgent({
      service: this.service,
      persistSession: (evt, session) => {
        if ((evt === 'create' || evt === 'update') && session) {
          this.onSessionUpdate?.({ service: this.service, session });
        } else if (evt === 'expired') {
          this.onSessionUpdate?.(null);
        }
      },
    });
  }

  async login(serviceUrl: string, identifier: string, password: string): Promise<StoredAuth> {
    const agent = this.createAgent(serviceUrl);
    const res = await agent.login({
      identifier: identifier.trim(),
      password: password.trim(),
    });
    if (!res.success || !agent.session) {
      throw new Error('Bluesky login did not return a valid session');
    }
    this.agent = agent;
    const auth: StoredAuth = { service: this.service, session: agent.session };
    this.onSessionUpdate?.(auth);
    return auth;
  }

  async resume(stored: StoredAuth): Promise<void> {
    const agent = this.createAgent(stored.service);
    const res = await agent.resumeSession(stored.session);
    if (!res.success) {
      throw new Error('Failed to resume saved Bluesky session');
    }
    this.agent = agent;
  }

  logout(): void {
    this.agent = null;
    this.onSessionUpdate?.(null);
  }

  get handle(): string | undefined {
    return this.agent?.session?.handle;
  }

  isAuthenticated(): boolean {
    return Boolean(this.agent?.session);
  }

  async fetchFeed(
    feedName: FeedName,
    limit = 25,
    cursor?: string,
  ): Promise<{ posts: SkyPost[]; cursor?: string }> {
    if (!this.agent) throw new Error('Not signed in');
    if (feedName === 'Following') {
      const res = await this.agent.getTimeline({ limit, cursor });
      return {
        posts: res.data.feed.map(mapFeedPost),
        cursor: res.data.cursor,
      };
    }
    const res = await this.agent.app.bsky.feed.getFeed({
      feed: DISCOVER_FEED_URI,
      limit,
      cursor,
    });
    return {
      posts: res.data.feed.map(mapFeedPost),
      cursor: res.data.cursor,
    };
  }

  async fetchReplies(post: SkyPost): Promise<SkyReply[]> {
    if (!this.agent) throw new Error('Not signed in');
    const res = await this.agent.getPostThread({
      uri: post.uri,
      depth: 1,
      parentHeight: 0,
    });
    const thread = res.data.thread;
    if (!AppBskyFeedDefs.isThreadViewPost(thread) || !thread.replies) {
      post.replies = [];
      return [];
    }
    const replies: SkyReply[] = [];
    for (const r of thread.replies) {
      if (!AppBskyFeedDefs.isThreadViewPost(r)) continue;
      const rec = r.post.record as { text?: string; createdAt?: string };
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
    if (!this.agent) throw new Error('Not signed in');
    if (post.liked && post.likeUri) {
      await this.agent.deleteLike(post.likeUri);
      post.liked = false;
      post.likeUri = undefined;
      post.likes = Math.max(0, post.likes - 1);
      return false;
    }
    const res = await this.agent.like(post.uri, post.cid);
    post.liked = true;
    post.likeUri = res.uri;
    post.likes += 1;
    return true;
  }

  async toggleRepost(post: SkyPost): Promise<boolean> {
    if (!this.agent) throw new Error('Not signed in');
    if (post.reposted && post.repostUri) {
      await this.agent.deleteRepost(post.repostUri);
      post.reposted = false;
      post.repostUri = undefined;
      post.reposts = Math.max(0, post.reposts - 1);
      return false;
    }
    const res = await this.agent.repost(post.uri, post.cid);
    post.reposted = true;
    post.repostUri = res.uri;
    post.reposts += 1;
    return true;
  }

  async fetchNotifications(
    limit = 25,
    cursor?: string,
  ): Promise<{ notifications: SkyNotification[]; cursor?: string }> {
    if (!this.agent) throw new Error('Not signed in');
    const res = await this.agent.listNotifications({ limit, cursor });
    const raw = res.data.notifications;

    // Resolve subject post text for likes and reposts (batch up to 25 URIs).
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
          .map((n) => n.reasonSubject!)
      ),
    ).slice(0, 25);

    const subjectTextMap = new Map<string, string>();
    if (subjectUris.length > 0) {
      try {
        const postsRes = await this.agent.getPosts({ uris: subjectUris });
        for (const p of postsRes.data.posts) {
          const rec = p.record as { text?: string };
          if (rec.text) {
            subjectTextMap.set(p.uri, rec.text);
          }
        }
      } catch {
        // Non-fatal: fall back to showing notification without quoted subject text.
      }
    }

    const notifications: SkyNotification[] = raw.map((n) => {
      const rec = n.record as { text?: string };
      const textFromRecord = typeof rec.text === 'string' ? rec.text : '';
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
      cursor: res.data.cursor,
    };
  }
}
