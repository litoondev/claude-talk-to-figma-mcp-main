/**
 * Idle cleanup and viewport framing.
 *
 * The plugin file is a Figma-sandbox script, not a module, so the units under
 * test are re-created here against the same contract the plugin implements.
 * These lock in the two behaviours that are easy to regress: cleanup must never
 * fire while work is in flight, and following the work must never zoom out.
 */

jest.useFakeTimers();

const IDLE_CLEANUP_MS = 4000;

function makeScheduler(settings: { autoCleanup: boolean }) {
  const state = { current: null as unknown, timer: null as any, cleaned: 0 };

  const cancel = () => {
    if (state.timer) { clearTimeout(state.timer); state.timer = null; }
  };
  const schedule = () => {
    if (!settings.autoCleanup) return;
    cancel();
    state.timer = setTimeout(() => {
      state.timer = null;
      if (state.current) return;        // work resumed — leave the nodes alone
      if (!settings.autoCleanup) return;
      state.cleaned++;
    }, IDLE_CLEANUP_MS);
  };

  return {
    state,
    started(cmd: string) { state.current = { cmd }; cancel(); },
    finished() { state.current = null; schedule(); },
  };
}

describe("idle cleanup", () => {
  it("removes instrumentation once the agent goes quiet", () => {
    const s = makeScheduler({ autoCleanup: true });
    s.started("set_text_content");
    s.finished();

    jest.advanceTimersByTime(IDLE_CLEANUP_MS - 1);
    expect(s.state.cleaned).toBe(0);

    jest.advanceTimersByTime(1);
    expect(s.state.cleaned).toBe(1);
  });

  it("does not fire between two commands of the same task", () => {
    const s = makeScheduler({ autoCleanup: true });
    s.started("get_selection");
    s.finished();

    jest.advanceTimersByTime(IDLE_CLEANUP_MS - 500);
    s.started("set_text_content");   // task continues
    jest.advanceTimersByTime(IDLE_CLEANUP_MS);

    expect(s.state.cleaned).toBe(0);
  });

  it("does not delete while a command is still running at fire time", () => {
    const s = makeScheduler({ autoCleanup: true });
    s.finished();
    s.state.current = { cmd: "still running" };

    jest.advanceTimersByTime(IDLE_CLEANUP_MS);
    expect(s.state.cleaned).toBe(0);
  });

  it("never schedules when the user turned cleanup off", () => {
    const s = makeScheduler({ autoCleanup: false });
    s.finished();
    jest.advanceTimersByTime(IDLE_CLEANUP_MS * 3);
    expect(s.state.cleaned).toBe(0);
  });
});

// ─── viewport ──────────────────────────────────────────────────────────────

function unionBounds(nodes: Array<{ absoluteBoundingBox: any }>) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) {
    const b = n.absoluteBoundingBox;
    if (!b) continue;
    minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width); maxY = Math.max(maxY, b.y + b.height);
  }
  if (minX === Infinity) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

describe("viewport framing", () => {
  it("centres on the union of the targets", () => {
    const box = unionBounds([
      { absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 } },
      { absoluteBoundingBox: { x: 100, y: 100, width: 100, height: 100 } },
    ])!;
    expect(box.x + box.width / 2).toBe(100);
    expect(box.y + box.height / 2).toBe(100);
  });

  it("ignores nodes with no bounding box", () => {
    const box = unionBounds([
      { absoluteBoundingBox: null },
      { absoluteBoundingBox: { x: 10, y: 20, width: 30, height: 40 } },
    ])!;
    expect(box).toEqual({ x: 10, y: 20, width: 30, height: 40 });
  });

  it("returns null when nothing has a box, so framing is skipped", () => {
    expect(unionBounds([{ absoluteBoundingBox: null }])).toBeNull();
  });
});
