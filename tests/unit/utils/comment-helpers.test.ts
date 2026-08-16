import {
  describeAnchor,
  extractNodeId,
  filterThreads,
  formatThreadDigest,
  groupIntoThreads,
  threadInvolvesAuthor,
  toThreadSummaries,
} from '../../../src/talk_to_figma_mcp/utils/comment-helpers';
import type { FigmaComment } from '../../../src/talk_to_figma_mcp/utils/figma-rest';

const ME = { id: 'user-me', handle: 'design-orangetoolz' };
const OTHER = { id: 'user-other', handle: 'teammate' };

function comment(overrides: Partial<FigmaComment> & { id: string }): FigmaComment {
  return {
    file_key: 'FILE1',
    parent_id: '',
    user: ME,
    created_at: '2026-08-01T10:00:00Z',
    resolved_at: null,
    message: 'placeholder',
    order_id: '1',
    client_meta: null,
    ...overrides,
  } as FigmaComment;
}

describe('comment helpers', () => {
  describe('describeAnchor / extractNodeId', () => {
    it('describes a node-anchored pin and extracts its node id', () => {
      const meta = { node_id: '12:34', node_offset: { x: 10.4, y: 20.6 } };
      expect(describeAnchor(meta)).toBe('node 12:34 at +(10, 21)');
      expect(extractNodeId(meta)).toBe('12:34');
    });

    it('describes a raw canvas pin', () => {
      expect(describeAnchor({ x: 100.2, y: -50.7 })).toBe('canvas (100, -51)');
      expect(extractNodeId({ x: 1, y: 2 })).toBeUndefined();
    });

    it('describes an unpinned file-level comment', () => {
      expect(describeAnchor(null)).toBe('unpinned (file-level comment)');
      expect(extractNodeId(null)).toBeUndefined();
    });
  });

  describe('groupIntoThreads', () => {
    it('nests replies under their root and sorts them chronologically', () => {
      const threads = groupIntoThreads([
        comment({ id: 'r2', parent_id: 'root1', created_at: '2026-08-03T10:00:00Z', message: 'second' }),
        comment({ id: 'root1', message: 'the root' }),
        comment({ id: 'r1', parent_id: 'root1', created_at: '2026-08-02T10:00:00Z', message: 'first' }),
      ]);

      expect(threads).toHaveLength(1);
      expect(threads[0].rootId).toBe('root1');
      expect(threads[0].message).toBe('the root');
      expect(threads[0].replies.map((r) => r.message)).toEqual(['first', 'second']);
    });

    it('tracks participants, last message author and last activity', () => {
      const [thread] = groupIntoThreads([
        comment({ id: 'root1', user: ME }),
        comment({ id: 'r1', parent_id: 'root1', user: OTHER, created_at: '2026-08-05T09:00:00Z' }),
      ]);

      expect(thread.participants).toEqual([ME.handle, OTHER.handle]);
      expect(thread.lastMessageAuthorId).toBe(OTHER.id);
      expect(thread.lastMessageAt).toBe('2026-08-05T09:00:00Z');
    });

    it('promotes orphaned replies instead of dropping them', () => {
      const threads = groupIntoThreads([
        comment({ id: 'orphan', parent_id: 'deleted-root', message: 'still matters' }),
      ]);

      expect(threads).toHaveLength(1);
      expect(threads[0].rootId).toBe('orphan');
    });

    it('marks resolved threads and carries the file name through', () => {
      const [thread] = groupIntoThreads(
        [comment({ id: 'root1', resolved_at: '2026-08-04T10:00:00Z' })],
        'Design System'
      );

      expect(thread.resolved).toBe(true);
      expect(thread.resolvedAt).toBe('2026-08-04T10:00:00Z');
      expect(thread.fileName).toBe('Design System');
    });

    it('orders threads by most recent activity first', () => {
      const threads = groupIntoThreads([
        comment({ id: 'old', created_at: '2026-07-01T10:00:00Z' }),
        comment({ id: 'new', created_at: '2026-08-10T10:00:00Z' }),
      ]);

      expect(threads.map((t) => t.rootId)).toEqual(['new', 'old']);
    });

    it('returns an empty array for no comments', () => {
      expect(groupIntoThreads([])).toEqual([]);
    });
  });

  describe('threadInvolvesAuthor', () => {
    const [thread] = groupIntoThreads([
      comment({ id: 'root1', user: OTHER }),
      comment({ id: 'r1', parent_id: 'root1', user: ME, created_at: '2026-08-02T10:00:00Z' }),
    ]);

    it("matches on replies when scope is 'any'", () => {
      expect(threadInvolvesAuthor(thread, ME.id, 'any')).toBe(true);
    });

    it("ignores replies when scope is 'root'", () => {
      expect(threadInvolvesAuthor(thread, ME.id, 'root')).toBe(false);
      expect(threadInvolvesAuthor(thread, OTHER.id, 'root')).toBe(true);
    });
  });

  describe('filterThreads', () => {
    const threads = groupIntoThreads([
      comment({ id: 'mine-open', user: ME, created_at: '2026-08-10T10:00:00Z' }),
      comment({ id: 'mine-resolved', user: ME, resolved_at: '2026-08-09T10:00:00Z', created_at: '2026-08-09T09:00:00Z' }),
      comment({ id: 'theirs', user: OTHER, created_at: '2026-08-08T10:00:00Z' }),
      comment({ id: 'ancient', user: ME, created_at: '2026-01-01T10:00:00Z' }),
    ]);

    it('excludes resolved threads by default', () => {
      const result = filterThreads(threads, { authorId: ME.id });
      expect(result.map((t) => t.rootId)).toEqual(['mine-open', 'ancient']);
    });

    it('includes resolved threads on request', () => {
      const result = filterThreads(threads, { authorId: ME.id, includeResolved: true });
      expect(result.map((t) => t.rootId)).toContain('mine-resolved');
    });

    it('filters by author', () => {
      const result = filterThreads(threads, { authorId: OTHER.id });
      expect(result.map((t) => t.rootId)).toEqual(['theirs']);
    });

    it('filters by since timestamp', () => {
      const result = filterThreads(threads, { authorId: ME.id, since: '2026-08-01T00:00:00Z' });
      expect(result.map((t) => t.rootId)).toEqual(['mine-open']);
    });

    it('returns everything open when no author is given', () => {
      const result = filterThreads(threads);
      expect(result).toHaveLength(3);
    });

    it('onlyAwaitingReply keeps threads whose last message is from someone else', () => {
      const conversation = groupIntoThreads([
        comment({ id: 'waiting', user: ME }),
        comment({ id: 'w-reply', parent_id: 'waiting', user: OTHER, created_at: '2026-08-11T10:00:00Z' }),
        comment({ id: 'answered', user: ME, created_at: '2026-08-06T10:00:00Z' }),
        comment({ id: 'a-reply', parent_id: 'answered', user: ME, created_at: '2026-08-07T10:00:00Z' }),
      ]);

      const result = filterThreads(conversation, { authorId: ME.id, onlyAwaitingReply: true });
      expect(result.map((t) => t.rootId)).toEqual(['waiting']);
    });

    it('ignores an unparseable since value rather than dropping everything', () => {
      const result = filterThreads(threads, { authorId: ME.id, since: 'not-a-date' });
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe('formatThreadDigest', () => {
    it('renders status, anchor and replies', () => {
      const threads = groupIntoThreads([
        comment({
          id: 'root1',
          message: 'Contrast is too low here',
          client_meta: { node_id: '5:10', node_offset: { x: 4, y: 8 } },
        }),
        comment({ id: 'r1', parent_id: 'root1', user: OTHER, message: 'Agreed, fixing', created_at: '2026-08-02T10:00:00Z' }),
      ]);

      const output = formatThreadDigest(threads);
      expect(output).toContain('[open]');
      expect(output).toContain('node 5:10');
      expect(output).toContain('Contrast is too low here');
      expect(output).toContain('↳ teammate: "Agreed, fixing"');
      expect(output).toContain('1 reply');
    });

    it('truncates long messages', () => {
      const threads = groupIntoThreads([comment({ id: 'root1', message: 'x'.repeat(500) })]);
      const output = formatThreadDigest(threads, { messageLength: 20 });
      expect(output).toContain('…');
      expect(output).not.toContain('x'.repeat(50));
    });

    it('handles the empty case', () => {
      expect(formatThreadDigest([])).toBe('No matching comment threads.');
    });
  });

  describe('toThreadSummaries', () => {
    it('projects the fields needed to act on a thread', () => {
      const threads = groupIntoThreads([
        comment({ id: 'root1', client_meta: { node_id: '9:9', node_offset: { x: 0, y: 0 } } }),
        comment({ id: 'r1', parent_id: 'root1', user: OTHER, created_at: '2026-08-02T10:00:00Z' }),
      ]);

      const [summary] = toThreadSummaries(threads);
      expect(summary.commentId).toBe('root1');
      expect(summary.fileKey).toBe('FILE1');
      expect(summary.nodeId).toBe('9:9');
      expect(summary.replyCount).toBe(1);
      expect(summary.replies[0].author).toBe(OTHER.handle);
    });
  });
});
