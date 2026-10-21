import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ContextMenu, type ContextMenuOption } from '@/app/components/ide/ContextMenu';
import { APP_CONFIG_KEYS, readAppPref, writeAppPref } from '@/lib/config/appConfig';
import { graphColorHex } from '@/lib/git/graphColors';
import { openGraphTab } from '@/lib/git/graphEntry';
import { reachableFrom } from '@/lib/git/graphLayout';
import { matchingOids } from '@/lib/git/graphSearch';
import { openMergeTabOrToast } from '@/lib/ide/openMergeTab';
import { useStore } from '@/lib/store';
import { resolveBranchFilterTip, type GraphBranchFilter } from '@/lib/store/gitGraphSlice';
import type { GitRef } from '@/lib/tauri/gitGraph';
import { GraphBanners, GraphEmptyState } from './GraphBanners';
import { GraphInspector } from './GraphInspector';
import { GraphList, type RevealRequest } from './GraphList';
import type { Point } from './GraphRowItem';
import { GraphToolbar } from './GraphToolbar';
import { buildCombinedMenu, buildCommitMenu, buildRefMenu, writeBlockedReason } from './graphMenus';
import { steppedMatchIndex } from './graphMatches';
import { refsByOid } from './graphRefs';
import {
  InspectorResizer,
  clampInspectorWidth,
  parseStoredInspectorWidth,
} from './InspectorResizer';
import { openRevisionDiff } from './openRevisionDiff';
import { useGraphCommands } from './useGraphCommands';

const CLOCK_TICK_MS = 60_000;
const NO_PEEK_MATCHES: string[] = [];

const MENU_LABELS: Record<MenuState['kind'], string> = {
  commit: 'Commit actions',
  ref: 'Reference actions',
  'branch-filter': 'Branch filter',
  'checkout-branch': 'Check out a branch',
};

type MenuState =
  | { kind: 'commit'; oid: string; at: Point; withRefs: boolean }
  | { kind: 'ref'; ref: GitRef; at: Point }
  | { kind: 'branch-filter'; at: Point }
  | { kind: 'checkout-branch'; at: Point };

function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

/** Reload when the window comes back and HEAD or any ref moved while it was away. */
function useReloadOnFocus(repoPath: string) {
  useEffect(() => {
    const onFocus = () => {
      const { refreshRefs, loadFirstPage } = useStore.getState();
      void refreshRefs(repoPath)
        .then((changed) => (changed ? loadFirstPage(repoPath) : undefined))
        .catch(() => undefined);
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [repoPath]);
}

function branchFilterLabel(filter: GraphBranchFilter, refs: GitRef[]): string {
  if (!filter) return 'All Branches';
  if (filter === 'current') return 'Current Branch';
  return refs.find((r) => r.name === filter)?.shorthand ?? 'All Branches';
}

export function GitGraphView({ repoPath }: { repoPath: string }) {
  const graph = useStore((s) => s.graphs[repoPath]);
  const repos = useStore((s) => s.repos);
  const nowMs = useNow();
  const searchRef = useRef<HTMLInputElement>(null);
  const listWrap = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [reveal, setReveal] = useState<RevealRequest | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [inspectorWidth, setInspectorWidth] = useState(() =>
    parseStoredInspectorWidth(readAppPref(APP_CONFIG_KEYS.gitGraphInspectorWidth))
  );

  useEffect(() => {
    void useStore.getState().openGraph(repoPath);
  }, [repoPath]);
  useReloadOnFocus(repoPath);

  const commits = graph?.commits;
  const refs = graph?.refs ?? null;
  const filterText = graph?.filterText ?? '';
  const selectedOid = graph?.selectedOid ?? null;

  const refMap = useMemo(() => refsByOid(refs), [refs]);
  const matchOids = useMemo(
    () => (commits ? matchingOids(commits, refs?.refs ?? [], filterText) : NO_PEEK_MATCHES),
    [commits, refs, filterText]
  );
  const matchSet = useMemo(() => new Set(matchOids), [matchOids]);
  const tip = resolveBranchFilterTip(graph?.branchFilter ?? null, refs);
  const dimmedOids = useMemo(() => {
    if (!tip || !commits) return null;
    const reached = reachableFrom(commits, tip);
    return new Set(commits.filter((c) => !reached.has(c.oid)).map((c) => c.oid));
  }, [commits, tip]);

  const revealHead = useCallback(
    (pulse: boolean) => {
      const { graphs, selectGraphCommit } = useStore.getState();
      const headOid = graphs[repoPath]?.refs?.headOid;
      if (!headOid) return;
      selectGraphCommit(repoPath, headOid);
      setReveal((prev) => ({ oid: headOid, pulse, nonce: (prev?.nonce ?? 0) + 1 }));
    },
    [repoPath]
  );
  const onHeadMoved = useCallback(() => revealHead(true), [revealHead]);
  const opener = useRef<HTMLElement | null>(null);
  const getOpener = useCallback(() => opener.current, []);
  const { actionsAt, overlay, busyOid } = useGraphCommands(repoPath, onHeadMoved, getOpener);

  /** A menu closes in the commit that opens its sheet, so what to refocus is noted before it opens. */
  const showMenu = useCallback((state: MenuState) => {
    const active = document.activeElement;
    opener.current =
      active instanceof HTMLElement && active !== document.body
        ? active
        : (listWrap.current?.querySelector<HTMLElement>('[role="listbox"]') ?? null);
    setMenu(state);
  }, []);

  const select = useCallback(
    (oid: string) => useStore.getState().selectGraphCommit(repoPath, oid),
    [repoPath]
  );
  const loadMore = useCallback(() => void useStore.getState().loadMore(repoPath), [repoPath]);
  const copySha = useCallback(
    (oid: string) => actionsAt({ x: 0, y: 0 }).copy(oid, 'SHA'),
    [actionsAt]
  );
  const openCommitMenu = useCallback(
    (commit: { oid: string }, at: Point, withRefs = false) =>
      showMenu({ kind: 'commit', oid: commit.oid, at, withRefs }),
    [showMenu]
  );
  const openRefMenu = useCallback(
    (ref: GitRef, at: Point) => showMenu({ kind: 'ref', ref, at }),
    [showMenu]
  );

  const selectedIndex =
    commits && selectedOid ? commits.findIndex((c) => c.oid === selectedOid) : -1;
  const matchPositions = useMemo(
    () => (commits ? matchOids.map((oid) => commits.findIndex((c) => c.oid === oid)) : []),
    [commits, matchOids]
  );
  const matchIndex = matchOids.findIndex((oid) => oid === selectedOid);

  const stepMatch = useCallback(
    (direction: 1 | -1) => {
      const target = steppedMatchIndex(matchPositions, selectedIndex, direction);
      if (target !== null) select(matchOids[target]);
    },
    [matchOids, matchPositions, selectedIndex, select]
  );

  const clearOrDeselect = useCallback(() => {
    const store = useStore.getState();
    if (filterText) store.setGraphFilterText(repoPath, '');
    else store.selectGraphCommit(repoPath, null);
  }, [filterText, repoPath]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    const command = event.metaKey || event.ctrlKey;
    if (command && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
    } else if (command && event.key.toLowerCase() === 'g') {
      event.preventDefault();
      stepMatch(event.shiftKey ? -1 : 1);
    } else if (event.key === 'Escape' && event.target === searchRef.current) {
      event.preventDefault();
      useStore.getState().setGraphFilterText(repoPath, '');
      listWrap.current?.querySelector<HTMLElement>('[role="listbox"]')?.focus();
    } else if (event.key === 'Enter' && event.target === searchRef.current) {
      event.preventDefault();
      stepMatch(1);
    }
  };

  if (!graph) {
    return repos.some((r) => r.path === repoPath) ? (
      <GraphEmptyState kind="loading" />
    ) : (
      <GraphEmptyState kind="no-repo" />
    );
  }

  const menuContext = { refs, busy: graph.busy };
  const selected = selectedIndex >= 0 && commits ? commits[selectedIndex] : undefined;
  const refList = refs?.refs ?? [];

  const menuOptions = (state: MenuState): ContextMenuOption[] => {
    const actions = actionsAt(state.at);
    if (state.kind === 'ref') return buildRefMenu(state.ref, menuContext, actions);
    if (state.kind === 'commit') {
      const commit = commits?.find((c) => c.oid === state.oid);
      if (!commit) return [];
      // Pills cannot take keyboard focus, so a keyboard-opened menu also carries their actions.
      return state.withRefs
        ? buildCombinedMenu(commit, refMap.get(commit.oid) ?? [], menuContext, actions)
        : buildCommitMenu(commit, menuContext, actions);
    }
    if (state.kind === 'checkout-branch') {
      const blocked = writeBlockedReason(menuContext);
      return refList
        .filter((r) => r.kind === 'local')
        .map((r) => ({
          label: r.shorthand,
          action: () => actions.checkoutRef(r),
          disabledReason: blocked,
        }));
    }
    const choose = (filter: GraphBranchFilter) => () =>
      useStore.getState().setGraphBranchFilter(repoPath, filter);
    const marked = (filter: GraphBranchFilter, label: string): ContextMenuOption => ({
      label,
      checked: (graph.branchFilter ?? null) === filter,
      action: choose(filter),
    });
    return [
      marked(null, 'All Branches'),
      marked('current', 'Current Branch'),
      { type: 'separator' },
      ...refList
        .filter((r) => r.kind === 'local' || r.kind === 'remote')
        .map((r) => marked(r.name, r.shorthand)),
    ];
  };

  const openMergePanel = async () => {
    const state = await useStore.getState().refreshMergeState(repoPath);
    const first = state?.conflicts[0]?.path;
    if (first) openMergeTabOrToast(repoPath, first);
    else
      useStore
        .getState()
        .showToast('No conflicts to resolve. Finish the operation in Source Control.', 'info');
  };

  const showEmpty = !graph.loading && graph.commits.length === 0;

  return (
    <div
      data-testid="git-graph"
      className="flex h-full min-h-0 flex-col bg-editor-bg"
      onKeyDown={onKeyDown}
    >
      <GraphToolbar
        repos={repos.map((r) => ({ path: r.path, name: r.name }))}
        repoPath={repoPath}
        onRepoChange={openGraphTab}
        query={filterText}
        onQueryChange={(text) => useStore.getState().setGraphFilterText(repoPath, text)}
        matchCount={matchOids.length}
        matchIndex={matchIndex}
        onStepMatch={stepMatch}
        searchRef={searchRef}
        branchFilterLabel={branchFilterLabel(graph.branchFilter, refList)}
        onOpenBranchFilter={(at) => showMenu({ kind: 'branch-filter', at })}
        onJumpToHead={() => revealHead(true)}
        jumpDisabledReason={refs?.headOid ? undefined : 'This repository has no commits yet.'}
        inspectorOpen={inspectorOpen}
        onToggleInspector={() => setInspectorOpen((open) => !open)}
      />
      <GraphBanners
        refs={refs}
        onCheckoutBranch={(at) => showMenu({ kind: 'checkout-branch', at })}
        onOpenMergePanel={() => void openMergePanel()}
      />
      <div role="status" className="sr-only">
        {graph.busy ? `${graph.busy}…` : ''}
      </div>
      <div className="flex min-h-0 flex-1">
        <div ref={listWrap} className="flex min-w-0 flex-1 flex-col">
          {graph.lastError && graph.commits.length === 0 ? (
            <GraphEmptyState
              kind="error"
              message={graph.lastError}
              onRetry={() => void useStore.getState().loadFirstPage(repoPath)}
            />
          ) : showEmpty ? (
            <GraphEmptyState kind={refs ? 'no-commits' : 'loading'} />
          ) : (
            <GraphList
              commits={graph.commits}
              rows={graph.rows}
              refsByOid={refMap}
              selectedOid={selectedOid}
              matches={matchSet}
              searching={filterText.trim().length > 0}
              dimmedOids={dimmedOids}
              headOid={refs?.headOid ?? null}
              busyOid={graph.busy ? busyOid : null}
              hasMore={graph.hasMore}
              nowMs={nowMs}
              reveal={reveal}
              onSelect={select}
              onLoadMore={loadMore}
              onToggleInspector={() => setInspectorOpen((open) => !open)}
              onCopySha={copySha}
              onEscape={clearOrDeselect}
              onCommitContextMenu={openCommitMenu}
              onRefContextMenu={openRefMenu}
            />
          )}
        </div>
        {inspectorOpen && (
          <>
            <InspectorResizer
              width={inspectorWidth}
              onChange={setInspectorWidth}
              onCommit={(width) =>
                writeAppPref(
                  APP_CONFIG_KEYS.gitGraphInspectorWidth,
                  String(clampInspectorWidth(width))
                )
              }
            />
            <aside
              aria-label="Commit inspector"
              style={{ width: inspectorWidth }}
              className="min-h-0 shrink-0 bg-panel-bg"
            >
              {selected ? (
                <GraphInspector
                  key={selected.oid}
                  repoPath={repoPath}
                  commit={selected}
                  refs={refMap.get(selected.oid) ?? []}
                  laneColor={graphColorHex(graph.rows[selectedIndex]?.color ?? 0)}
                  parentSummary={(oid) => commits?.find((c) => c.oid === oid)?.summary}
                  onSelectParent={select}
                  onFileClick={(path, parentIndex) =>
                    void openRevisionDiff(repoPath, selected, path, parentIndex)
                  }
                  onCopySha={copySha}
                  onOpenMenu={(at) => openCommitMenu(selected, at, true)}
                  onRefMenu={openRefMenu}
                />
              ) : (
                <p className="p-4 text-xs text-foreground-muted">Select a commit to inspect it.</p>
              )}
            </aside>
          </>
        )}
      </div>
      {menu && (
        <ContextMenu
          x={menu.at.x}
          y={menu.at.y}
          width={240}
          compact
          ariaLabel={MENU_LABELS[menu.kind]}
          options={menuOptions(menu)}
          onClose={() => setMenu(null)}
        />
      )}
      {overlay}
    </div>
  );
}
