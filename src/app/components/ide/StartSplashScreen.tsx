import { AuricIcon } from '../ui/AuricIcon';
import { InboxCapture } from '../inbox/InboxCapture';
import { ProjectSwitcher } from '../cockpit/ProjectSwitcher';
import { StartScreenAgentsLine, type DailyTip } from '../cockpit/StartScreenAgentsLine';
import { InboxPanel } from '../inbox/InboxPanel';

interface StartSplashScreenProps {
  onOpenFolder: () => void;
  onNewProject: () => void;
  onOpenRecent: (path: string) => void;
  dailyTip: DailyTip;
}

export function StartSplashScreen({
  onOpenFolder,
  onNewProject,
  onOpenRecent,
  dailyTip,
}: StartSplashScreenProps) {
  return (
    // items-center only (not justify-center): the hero's position
    // comes from the top padding, not from centering the whole
    // column's height. A wide inbox summary growing underneath it
    // must not walk the title around the screen.
    <div className="@container flex min-w-0 flex-1 flex-col items-center overflow-y-auto px-4 pt-[12vh] pb-12 text-center">
      <div className="w-full min-w-0 animate-in fade-in zoom-in duration-700">
        <h1 className="font-display text-4xl font-black tracking-tighter text-white @2xl:text-5xl">
          AURIC
          <span className="text-primary-light font-thin tracking-widest ml-2">IDE</span>
        </h1>
        <p className="mt-4 text-sm text-foreground-muted uppercase tracking-[0.3em] font-medium">
          AI-native Development
        </p>
        <div
          data-testid="start-buttons-row"
          className="mt-6 flex flex-wrap items-center justify-center gap-3"
        >
          <button
            onClick={onOpenFolder}
            className="rounded-xl bg-primary/10 border border-primary/20 px-8 py-3 text-sm font-bold text-primary-light transition-[background-color,box-shadow] duration-150 hover:bg-primary/20 hover:shadow-[0_0_30px_rgba(var(--primary-rgb),0.2)] active:scale-[0.98]"
          >
            Open Project Folder
          </button>
          <button
            onClick={onNewProject}
            data-testid="new-project-button"
            className="flex items-center gap-2 rounded-xl border border-white/10 px-6 py-3 text-sm font-bold text-foreground transition-[background-color,border-color] duration-150 hover:bg-white/5 hover:border-white/20 active:scale-[0.98]"
          >
            <AuricIcon name="add" className="text-[18px]" />
            New
          </button>
        </div>
        <div data-testid="start-inbox-capture" className="mx-auto mt-6 w-full min-w-0 max-w-3xl">
          <InboxCapture autoFocus />
        </div>
        <div
          data-testid="start-project-switcher"
          className="mt-6 flex w-full min-w-0 justify-center"
        >
          <ProjectSwitcher currentPath={null} onOpenProject={onOpenRecent} />
        </div>
        {/* Same width as the switcher above it: two blocks sharing
            one edge read as a column, two different widths read as
            clutter. Swaps to a running-agents line the moment
            there is something more useful to say than a tip. */}
        <StartScreenAgentsLine dailyTip={dailyTip} />
        {/* Nothing renders here until the inbox holds something —
            an empty inbox must leave the splash exactly as calm as
            it always was. */}
        <div data-testid="start-inbox-panel" className="mx-auto mt-6 w-full min-w-0 max-w-3xl">
          <InboxPanel variant="wide" hideCapture onOpenProject={onOpenRecent} />
        </div>
      </div>
    </div>
  );
}
