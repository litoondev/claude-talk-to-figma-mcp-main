import {
  recordActivity,
  getActivitySnapshot,
  setQueueDepth,
  forgetChannel,
  summarizeParams,
  extractNodeIds,
  extractNodeNames,
  describeCommand,
} from '../../src/activity';

/**
 * The activity module holds process-wide state (ring buffer, per-channel live
 * state). Tests use a unique channel each time and read back with a channel
 * filter, so ordering between tests cannot leak across assertions.
 */
let channelCounter = 0;
function freshChannel(): string {
  channelCounter += 1;
  return `test-channel-${channelCounter}`;
}

describe('activity log', () => {
  describe('recordActivity + getActivitySnapshot', () => {
    it('assigns monotonically increasing sequence numbers', () => {
      const channel = freshChannel();
      const a = recordActivity({ channel, kind: 'note', message: 'first' });
      const b = recordActivity({ channel, kind: 'note', message: 'second' });

      expect(b.seq).toBeGreaterThan(a.seq);
    });

    it('stamps a timestamp when none is supplied', () => {
      const channel = freshChannel();
      const before = Date.now();
      const event = recordActivity({ channel, kind: 'note', message: 'stamped' });

      expect(event.ts).toBeGreaterThanOrEqual(before);
      expect(event.ts).toBeLessThanOrEqual(Date.now());
    });

    it('filters events by channel', () => {
      const mine = freshChannel();
      const other = freshChannel();
      recordActivity({ channel: mine, kind: 'note', message: 'mine' });
      recordActivity({ channel: other, kind: 'note', message: 'theirs' });

      const snap = getActivitySnapshot({ channel: mine });
      expect(snap.events.every((e) => e.channel === mine)).toBe(true);
      expect(snap.events.map((e) => e.message)).toContain('mine');
      expect(snap.events.map((e) => e.message)).not.toContain('theirs');
    });

    it('returns only newer events when given "since"', () => {
      const channel = freshChannel();
      const first = recordActivity({ channel, kind: 'note', message: 'old' });
      recordActivity({ channel, kind: 'note', message: 'new' });

      const snap = getActivitySnapshot({ channel, since: first.seq });
      expect(snap.events.map((e) => e.message)).toEqual(['new']);
    });

    it('returns nothing when "since" is already caught up', () => {
      const channel = freshChannel();
      recordActivity({ channel, kind: 'note', message: 'only' });

      const caughtUp = getActivitySnapshot({ channel });
      const snap = getActivitySnapshot({ channel, since: caughtUp.latestSeq });
      expect(snap.events).toHaveLength(0);
    });

    it('keeps only the most recent events when limited', () => {
      const channel = freshChannel();
      for (let i = 0; i < 5; i++) {
        recordActivity({ channel, kind: 'note', message: `event-${i}` });
      }

      const snap = getActivitySnapshot({ channel, limit: 2 });
      expect(snap.events.map((e) => e.message)).toEqual(['event-3', 'event-4']);
    });
  });

  describe('live channel state', () => {
    it('reports working while a command is in flight', () => {
      const channel = freshChannel();
      recordActivity({
        channel,
        kind: 'started',
        command: 'create_frame',
        requestId: 'r1',
        message: 'create frame',
      });

      const state = getActivitySnapshot({ channel }).channels[0];
      expect(state.working).toBe(true);
      expect(state.currentCommand).toBe('create_frame');
      expect(state.currentRequestId).toBe('r1');
    });

    it('returns to idle and counts the completion', () => {
      const channel = freshChannel();
      recordActivity({ channel, kind: 'started', command: 'c', requestId: 'r1', message: 'go' });
      recordActivity({ channel, kind: 'completed', command: 'c', requestId: 'r1', message: 'done' });

      const state = getActivitySnapshot({ channel }).channels[0];
      expect(state.working).toBe(false);
      expect(state.currentCommand).toBeNull();
      expect(state.completed).toBe(1);
      expect(state.failed).toBe(0);
    });

    it('counts errors and timeouts as failures', () => {
      const channel = freshChannel();
      recordActivity({ channel, kind: 'started', command: 'c', requestId: 'r1', message: 'go' });
      recordActivity({ channel, kind: 'error', command: 'c', requestId: 'r1', message: 'boom' });
      recordActivity({ channel, kind: 'started', command: 'c', requestId: 'r2', message: 'go' });
      recordActivity({ channel, kind: 'timeout', command: 'c', requestId: 'r2', message: 'slow' });

      const state = getActivitySnapshot({ channel }).channels[0];
      expect(state.failed).toBe(2);
      expect(state.working).toBe(false);
    });

    it('does not let a late response clear a newer in-flight command', () => {
      // Regression guard: a stale reply for a timed-out command must not blank
      // out the state of the command that replaced it, or observers would
      // flicker to "idle" mid-operation.
      const channel = freshChannel();
      recordActivity({ channel, kind: 'started', command: 'slow', requestId: 'r1', message: 'go' });
      recordActivity({ channel, kind: 'timeout', command: 'slow', requestId: 'r1', message: 'timed out' });
      recordActivity({ channel, kind: 'started', command: 'next', requestId: 'r2', message: 'go' });

      // Late reply for the abandoned request.
      recordActivity({ channel, kind: 'completed', command: 'slow', requestId: 'r1', message: 'late' });

      const state = getActivitySnapshot({ channel }).channels[0];
      expect(state.working).toBe(true);
      expect(state.currentRequestId).toBe('r2');
      expect(state.currentCommand).toBe('next');
    });

    it('tracks queue depth', () => {
      const channel = freshChannel();
      recordActivity({ channel, kind: 'note', message: 'seed' });
      setQueueDepth(channel, 7);

      expect(getActivitySnapshot({ channel }).channels[0].queueDepth).toBe(7);
    });

    it('drops channel state on forgetChannel', () => {
      const channel = freshChannel();
      recordActivity({ channel, kind: 'completed', requestId: 'r1', message: 'done' });
      expect(getActivitySnapshot({ channel }).channels[0].completed).toBe(1);

      forgetChannel(channel);
      // Reading again recreates a zeroed state rather than resurrecting counts.
      expect(getActivitySnapshot({ channel }).channels[0].completed).toBe(0);
    });
  });

  describe('summarizeParams', () => {
    it('truncates long strings so image and SVG payloads cannot bloat the log', () => {
      const long = 'x'.repeat(5000);
      const out = summarizeParams({ imageData: long })!;

      expect(String(out.imageData).length).toBeLessThan(200);
      expect(String(out.imageData)).toContain('5000 chars');
    });

    it('preserves short scalar values verbatim', () => {
      const out = summarizeParams({ name: 'Hero', width: 100, visible: false })!;
      expect(out).toEqual({ name: 'Hero', width: 100, visible: false });
    });

    it('caps long arrays', () => {
      const out = summarizeParams({ items: Array.from({ length: 50 }, (_, i) => i) })!;
      const items = out.items as unknown[];
      expect(items.length).toBeLessThanOrEqual(9);
      expect(String(items[items.length - 1])).toContain('more');
    });

    it('returns undefined for non-object input', () => {
      expect(summarizeParams(undefined)).toBeUndefined();
      expect(summarizeParams('string')).toBeUndefined();
      expect(summarizeParams([1, 2, 3])).toBeUndefined();
    });
  });

  describe('extractNodeIds', () => {
    it('finds id, nodeId and parentId', () => {
      expect(extractNodeIds({ nodeId: '1:2' })).toContain('1:2');
      expect(extractNodeIds({ id: '3:4' })).toContain('3:4');
      expect(extractNodeIds({ parentId: '5:6' })).toContain('5:6');
    });

    it('expands a nodeIds array', () => {
      expect(extractNodeIds({ nodeIds: ['1:1', '2:2'] })).toEqual(['1:1', '2:2']);
    });

    it('walks into nested structures', () => {
      const ids = extractNodeIds({ result: { children: [{ id: '9:9' }] } });
      expect(ids).toContain('9:9');
    });

    it('deduplicates repeated ids', () => {
      const ids = extractNodeIds({ id: '1:1', nested: { nodeId: '1:1' } });
      expect(ids).toEqual(['1:1']);
    });

    it('respects the budget', () => {
      const many = Array.from({ length: 100 }, (_, i) => `${i}:0`);
      expect(extractNodeIds({ nodeIds: many }, 5)).toHaveLength(5);
    });
  });

  describe('extractNodeNames', () => {
    it('takes a name only when it accompanies an id', () => {
      expect(extractNodeNames({ id: '1:1', name: 'Hero' })).toEqual(['Hero']);
    });

    it('ignores names that are not node names', () => {
      // A font name has no sibling id and must not be mistaken for a node.
      expect(extractNodeNames({ fontName: { family: 'Inter', name: 'Inter Bold' } })).toEqual([]);
    });

    it('collects names from nested children', () => {
      const names = extractNodeNames({
        id: '0:1',
        name: 'Page',
        children: [{ id: '1:1', name: 'Card' }],
      });
      expect(names).toEqual(expect.arrayContaining(['Page', 'Card']));
    });
  });

  describe('describeCommand', () => {
    it('humanises the command name', () => {
      expect(describeCommand('create_frame', undefined)).toBe('create frame');
    });

    it('quotes a name when the params carry one', () => {
      expect(describeCommand('create_frame', { name: 'Hero' })).toBe('create frame — "Hero"');
    });

    it('truncates very long names', () => {
      const out = describeCommand('set_text_content', { text: 'y'.repeat(100) });
      expect(out).toContain('…');
      expect(out.length).toBeLessThan(70);
    });

    it('falls back to naming the targeted nodes', () => {
      expect(describeCommand('delete_node', { nodeId: '1:1' })).toBe('delete node on 1:1');
      expect(describeCommand('delete_node', { nodeIds: ['1:1', '2:2'] })).toBe(
        'delete node on 2 nodes'
      );
    });
  });
});
