# /// script
# requires-python = ">=3.10"
# dependencies = ["textual==1.0.0"]
# ///
"""A clickable, two-level progress board for a plan tracked in TASKS.md.

Two expandable layers: the phase (the larger step) and, inside it, each task —
which opens to show the detail recorded in the companion history file. Expanding
works with the mouse (click the title) and with the keyboard (arrows to move,
right to open, left to close, Enter to toggle).

The file is watched and the board refreshes itself when the plan changes, keeping
whatever the reader had expanded or collapsed.

Run it (dependencies live in the PEP 723 header above; uv resolves them into its
own cache, nothing is installed system-wide):

    uv run tasks-panel.py [--theme NAME] [path/to/TASKS.md]

Themes: alvesmaia (default), dourado, monokai, vscode-dark.

Keys: up/down move · right opens · left closes · Enter toggles · a expands all ·
c collapses all · r reloads · q quits
"""

from __future__ import annotations

import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

from rich.markup import escape
from textual.app import App, ComposeResult
from textual.binding import Binding
from textual.containers import VerticalScroll
from textual.reactive import reactive
from textual.widgets import Collapsible, Footer, Label, Static
from textual.widgets._collapsible import CollapsibleTitle

# TASKS.md is the convention; TRILHA.md is accepted so a repository that
# started on the older name keeps working.
BOARD_NAMES = ("TASKS.md", "TRILHA.md")

# Where the long-form detail lives. The first one that exists wins, so a project
# can name it in its own language.
DETAIL_NAMES = (
    Path("docs") / "historico-implementacao.md",
    Path("docs") / "task-details.md",
)

# The board's vocabulary. A section title that starts with one of these is an
# action section (decisions, blockers, debts) rather than a phase: it never
# starts collapsed, and its items may omit the icon because the icon is already
# in the title. Detecting it by icon instead of by section name keeps the board
# working in any language.
ICONS = ("✅", "▶️", "⬜", "⛔", "❓")
_ICON_GROUP = "|".join(ICONS)

SECTION = re.compile(r"^##\s+(.*)$")
ITEM = re.compile(rf"^\s*-\s+({_ICON_GROUP})\s*(.*)$")
ITEM_PLAIN = re.compile(rf"^\s*-\s+(?!{_ICON_GROUP})(.+)$")
LEADING_ICON = re.compile(rf"^({_ICON_GROUP})")

# A task line starts with its number: "12 · Ported the shell". The number is
# what links the board to the detail.
TASK_NUMBER = re.compile(r"^(\d+)\s*[·.\-)]")

# In the history file each task is "<icon> **Task N — title**" followed by its
# detail. No end anchor on purpose: the title may carry a trailing note such as
# "**Task 16 — ...** *(under review)*", and anchoring left that task with no
# detail at all.
HISTORY_TASK = re.compile(rf"^(?:{_ICON_GROUP})\s+\*\*Task\s+(\d+)\s*[—-]\s*(.*?)\*\*")

CSS_CLASS = {
    "✅": "done",
    "▶️": "running",
    "⬜": "todo",
    "⛔": "blocked",
    "❓": "decide",
}

@dataclass(frozen=True)
class ThemeColors:
    """Every color the board uses. One theme = one instance of this."""

    title: str
    summary: str
    text: str  # CollapsibleTitle / default item text
    done: str
    todo: str
    blocked: str
    decide: str
    detail: str
    focus_bg: str
    focus_fg: str
    shimmer_edge: str  # where the running band fades into SHIMMER_BASE
    shimmer_mid: str
    shimmer_peak: str  # brightest point, center of the band
    background: str | None = None  # None keeps Textual's own $surface
    running: str = "#FFFFFF"  # conventional white, same in every theme
    shimmer_base: str = "#FFFFFF"  # must match `running`: shimmer markup
    # always overrides the CSS color, so this is what "not shimmering" shows.


# Every color below is traceable to a real source, not picked freehand:
# alvesmaia from branding/brand/paleta.json, monokai and vscode-dark from
# those editors' actual default palettes.
THEMES: dict[str, ThemeColors] = {
    "alvesmaia": ThemeColors(
        title="#4F6BFF", summary="#5A7189", text="#EAF1F7", done="#5A7189",
        todo="#6C8298", blocked="#B02E21", decide="#96600B", detail="#5A7189",
        focus_bg="#3A5163", focus_fg="#F6F9FC",
        shimmer_edge="#B9C8D6", shimmer_mid="#4F6BFF", shimmer_peak="#EEF1FF",
    ),
    "dourado": ThemeColors(
        title="#F7C873", summary="#C9812F", text="#FFF3D6", done="#8F7A4E",
        todo="#9C8F74", blocked="#B02E21", decide="#96600B", detail="#C9812F",
        focus_bg="#3A5163", focus_fg="#F6F9FC",
        shimmer_edge="#C9812F", shimmer_mid="#F7C873", shimmer_peak="#FFF3D6",
    ),
    "monokai": ThemeColors(
        background="#272822",
        title="#A6E22E", summary="#75715E", text="#F8F8F2", done="#75715E",
        todo="#9E9B8A", blocked="#F92672", decide="#E6DB74", detail="#75715E",
        focus_bg="#49483E", focus_fg="#F8F8F2",
        shimmer_edge="#75715E", shimmer_mid="#66D9EF", shimmer_peak="#F8F8F2",
    ),
    "vscode-dark": ThemeColors(
        background="#1E1E1E",
        title="#569CD6", summary="#6A9955", text="#D4D4D4", done="#6A9955",
        todo="#808080", blocked="#F44747", decide="#DCDCAA", detail="#808080",
        focus_bg="#37373D", focus_fg="#D4D4D4",
        shimmer_edge="#808080", shimmer_mid="#569CD6", shimmer_peak="#DCEEFF",
    ),
}
DEFAULT_THEME = "alvesmaia"

SHIMMER_FPS = 15
# This many characters glow at once, sweeping left-to-right over a running
# item's text and looping. Widen this for a bigger glow; the gradient stays
# smooth either way since it's generated, not hand-listed.
SHIMMER_WIDTH = 15


def _lerp_hex(start: str, end: str, t: float) -> str:
    """Blend two `#rrggbb` colors, t=0 -> start, t=1 -> end."""
    s = tuple(int(start[i : i + 2], 16) for i in (1, 3, 5))
    e = tuple(int(end[i : i + 2], 16) for i in (1, 3, 5))
    return "#" + "".join(f"{round(a + (b - a) * t):02X}" for a, b in zip(s, e))


def _build_shimmer_colors(width: int, edge: str, mid: str, peak: str) -> tuple[str, ...]:
    """A symmetric gradient, `width` characters wide: edge -> mid -> peak -> mid -> edge."""
    half = (width - 1) / 2
    colors = []
    for i in range(width):
        t = 1 - abs(i - half) / half
        colors.append(
            _lerp_hex(edge, mid, t * 2) if t <= 0.5 else _lerp_hex(mid, peak, (t - 0.5) * 2)
        )
    return tuple(colors)


def shimmer_markup(text: str, frame: int, colors: tuple[str, ...], base: str) -> str:
    """`text` with a moving bright band, as Rich console markup.

    The band travels past both ends of the string before looping, so the
    glow visibly enters from the left and exits on the right rather than
    jumping back.
    """
    width = len(colors)
    period = len(text) + width
    center = (frame % period) - width
    out: list[str] = []
    for i, ch in enumerate(text):
        offset = i - center
        color = colors[offset] if 0 <= offset < width else base
        out.append(f"[bold {color}]{escape(ch)}[/]")
    return "".join(out)


def parse_theme(argv: list[str]) -> tuple[str, list[str]]:
    """Pull an optional `--theme NAME` / `--theme=NAME` out of argv.

    Returns the theme name and argv with that flag removed, so the rest of
    the script can keep treating argv[1] as the board path.
    """
    theme = DEFAULT_THEME
    remaining = [argv[0]] if argv else []
    i = 1
    while i < len(argv):
        arg = argv[i]
        if arg == "--theme":
            if i + 1 >= len(argv):
                raise SystemExit("--theme needs a name")
            theme = argv[i + 1]
            i += 2
        elif arg.startswith("--theme="):
            theme = arg.split("=", 1)[1]
            i += 1
        else:
            remaining.append(arg)
            i += 1

    if theme not in THEMES:
        choices = ", ".join(sorted(THEMES))
        raise SystemExit(f"unknown theme {theme!r}. Choices: {choices}")
    return theme, remaining


def find_board(argv: list[str]) -> Path:
    """Locate the board file so the script can live anywhere.

    Order: the path given on the command line, then the current directory and
    its parents. Deliberately not derived from `__file__`: installed as a skill,
    this script sits outside the repository it reports on.
    """
    if len(argv) > 1:
        given = Path(argv[1]).expanduser().resolve()
        if not given.is_file():
            raise SystemExit(f"no board file at {given}")
        return given

    here = Path.cwd().resolve()
    for directory in [here, *here.parents]:
        for name in BOARD_NAMES:
            candidate = directory / name
            if candidate.is_file():
                return candidate

    raise SystemExit(
        f"no {BOARD_NAMES[0]} in the current directory or any parent.\n"
        f"Pass one: tasks-panel.py <path-to-board>"
    )


def find_detail_file(board: Path) -> Path | None:
    for name in DETAIL_NAMES:
        candidate = board.parent / name
        if candidate.is_file():
            return candidate
    return None


def read_details(path: Path | None) -> dict[int, str]:
    """Each task's detail, by task number, from the history file."""
    if path is None:
        return {}

    details: dict[int, str] = {}
    number: int | None = None
    body: list[str] = []

    def flush() -> None:
        if number is not None and body:
            details[number] = "\n".join(body).strip()

    for line in path.read_text(encoding="utf-8").splitlines():
        if match := HISTORY_TASK.match(line):
            flush()
            number, body = int(match.group(1)), []
            continue
        if number is None:
            continue
        # A heading or another bold block ends the current detail.
        if line.startswith("#") or line.startswith("**"):
            flush()
            number, body = None, []
            continue
        if line.strip():
            body.append(line.strip())

    flush()
    return details


@dataclass
class Section:
    title: str
    items: list[tuple[str, str]] = field(default_factory=list)
    prose: list[str] = field(default_factory=list)

    @property
    def total(self) -> int:
        return len(self.items)

    @property
    def done(self) -> int:
        return sum(1 for icon, _ in self.items if icon == "✅")

    @property
    def is_phase(self) -> bool:
        """A phase tracks progress; an action section does not."""
        return self.total > 0 and not LEADING_ICON.match(self.title)

    @property
    def complete(self) -> bool:
        return self.is_phase and self.done == self.total

    def label(self) -> str:
        """Block title, with a progress bar when the section is a phase."""
        if not self.is_phase:
            return self.title
        bar = "█" * self.done + "░" * (self.total - self.done)
        return f"{self.title}   {bar}  {self.done}/{self.total}"


def read_sections(path: Path) -> tuple[list[str], list[Section]]:
    preamble: list[str] = []
    sections: list[Section] = []
    current: Section | None = None

    for line in path.read_text(encoding="utf-8").splitlines():
        if match := SECTION.match(line):
            current = Section(title=match.group(1).strip())
            sections.append(current)
            continue
        if current is None:
            preamble.append(line)
            continue
        if match := ITEM.match(line):
            current.items.append((match.group(1), match.group(2).strip()))
        elif match := ITEM_PLAIN.match(line):
            # Inherit the icon from the section title, which is where it is in
            # action sections.
            head = LEADING_ICON.match(current.title)
            current.items.append(
                (head.group(1) if head else "⬜", match.group(1).strip())
            )
        else:
            current.prose.append(line)

    return preamble, sections


class Board(App):
    # priority=True is required on the arrows: the scrollable container binds
    # up/down for scrolling and swallows the key before it reaches the app —
    # without this, focus never leaves the first item.
    BINDINGS = [
        Binding("down", "next", "down", priority=True),
        Binding("up", "previous", "up", priority=True),
        Binding("right", "open", "open", priority=True),
        Binding("left", "close", "close", priority=True),
        Binding("enter", "toggle", "toggle", priority=True),
        ("a", "expand_all", "all"),
        ("c", "collapse_all", "none"),
        ("r", "reload", "reload"),
        ("q", "quit", "quit"),
    ]

    mtime = reactive(0.0)

    def __init__(self, board: Path, theme: str = DEFAULT_THEME) -> None:
        super().__init__()
        self.board = board
        self.detail_file = find_detail_file(board)
        self.details: dict[int, str] = {}
        self._shimmer_frame = 0
        # (widget, plain text) for whatever is currently "running" — rebuilt
        # on every reload(), animated independently by _tick_shimmer().
        self._shimmer_targets: list[tuple[Static | Collapsible, str]] = []

        self.theme_colors = THEMES[theme]
        self._shimmer_colors = _build_shimmer_colors(
            SHIMMER_WIDTH, self.theme_colors.shimmer_edge, self.theme_colors.shimmer_mid, self.theme_colors.shimmer_peak
        )
        # Set per-instance rather than as a class-level CSS string, since the
        # theme is only known once __init__ runs. Textual reads self.CSS (not
        # the class attribute directly) when the app starts, so this is safe
        # as long as only one Board runs per process — which is the only way
        # this script is ever used.
        self.CSS = self._build_css(self.theme_colors)

    @staticmethod
    def _build_css(t: ThemeColors) -> str:
        background = t.background or "$surface"
        return f"""
        Screen {{ background: {background}; }}
        #title {{ padding: 0 2; text-style: bold; color: {t.title}; }}
        #path {{ padding: 0 2; color: {t.detail}; }}
        #summary {{ padding: 1 2 0 2; color: {t.summary}; }}
        Collapsible {{ border: none; background: transparent; }}
        CollapsibleTitle {{ color: {t.text}; text-style: bold; }}
        .item {{ padding: 0 0 0 2; }}
        .done {{ color: {t.done}; }}
        .running {{ color: {t.running}; text-style: bold; }}
        .todo {{ color: {t.todo}; }}
        .blocked {{ color: {t.blocked}; }}
        .decide {{ color: {t.decide}; }}
        .detail {{ padding: 0 0 1 4; color: {t.detail}; }}

        /* Textual's default focus style pulls a theme-blue cursor
        background, which reads as same-hue-on-same-hue against a colorful
        title/running/shimmer. A dark neutral reads as a plain selection. */
        CollapsibleTitle:focus {{
            background: {t.focus_bg};
            color: {t.focus_fg};
        }}
        """

    def compose(self) -> ComposeResult:
        yield Label("", id="title")
        yield Label("", id="path")
        yield Label("", id="summary")

        # VerticalScroll is focusable by default, so the first Down focused the
        # container instead of the first title — the keypress looked swallowed.
        # Only titles should take focus.
        body = VerticalScroll(id="body")
        body.can_focus = False
        yield body

        yield Footer()

    def on_mount(self) -> None:
        self.reload()
        # Watching by mtime keeps this dependency-free; a filesystem watcher
        # would be a library for one line of work.
        self.set_interval(1.0, self._check_file)
        self.set_interval(1 / SHIMMER_FPS, self._tick_shimmer)

    def _tick_shimmer(self) -> None:
        if not self._shimmer_targets:
            return
        self._shimmer_frame += 1
        for widget, text in self._shimmer_targets:
            markup = shimmer_markup(
                text, self._shimmer_frame, self._shimmer_colors, self.theme_colors.shimmer_base
            )
            if isinstance(widget, Collapsible):
                widget.title = markup
            else:
                widget.update(markup)

    def _check_file(self) -> None:
        try:
            current = self.board.stat().st_mtime
        except OSError:
            return
        if current != self.mtime:
            self.reload()

    def reload(self) -> None:
        # Remember what is expanded, so refreshing after a change does not
        # collapse the board under the reader.
        expanded = {c.title: not c.collapsed for c in self.query(Collapsible)}

        self.mtime = self.board.stat().st_mtime
        self.details = read_details(self.detail_file)
        preamble, sections = read_sections(self.board)

        heading = next(
            (l.lstrip("# ").strip() for l in preamble if l.startswith("# ")),
            self.board.stem,
        )
        self.query_one("#title", Label).update(heading)

        # The heading above can be any custom project name, so the board's
        # own path stays on-screen right under it — otherwise, with several
        # panels open, there's no way to tell which file a given one reads.
        self.query_one("#path", Label).update(str(self.board))

        done = sum(s.done for s in sections if s.is_phase)
        total = sum(s.total for s in sections if s.is_phase)
        needs_action = sum(s.total for s in sections if not s.is_phase)
        self.query_one("#summary", Label).update(
            f"{done} of {total} tasks  ·  {needs_action} items need attention"
        )

        body = self.query_one("#body", VerticalScroll)
        body.remove_children()

        # Rebuilt from scratch below; _tick_shimmer() only reads this list,
        # so it's safe to replace in one shot once the loop below is done.
        shimmer_targets: list[tuple[Static | Collapsible, str]] = []

        for section in sections:
            label = section.label()
            # A previous choice wins; on first load a finished phase starts
            # collapsed and everything else starts open.
            is_open = expanded.get(label, not section.complete)

            children: list[Static | Collapsible] = []
            section_running = False
            for icon, text in section.items:
                item_label = f"{icon}  {text}"
                classes = f"item {CSS_CLASS[icon]}"
                detail = None
                if match := TASK_NUMBER.match(text):
                    detail = self.details.get(int(match.group(1)))

                # A task with recorded detail expands too. Without detail it
                # would open to show nothing, so it stays a plain line — the
                # triangle appears only where there is something to read.
                if detail:
                    item_widget: Static | Collapsible = Collapsible(
                        Static(detail, classes="detail"),
                        title=item_label,
                        collapsed=not expanded.get(item_label, False),
                        classes=classes,
                    )
                else:
                    item_widget = Static(item_label, classes=classes)
                children.append(item_widget)

                if icon == "▶️":
                    section_running = True
                    shimmer_targets.append((item_widget, item_label))

            if not children:
                prose = "\n".join(section.prose).strip()
                if not prose:
                    continue
                children = [Static(prose, classes="item")]

            phase_widget = Collapsible(*children, title=label, collapsed=not is_open)
            # A phase currently doing something shimmers too, not just the
            # task inside it — the board's job is to say "this is moving".
            if section.is_phase and section_running:
                shimmer_targets.append((phase_widget, label))
            body.mount(phase_widget)

        self._shimmer_targets = shimmer_targets
        self._shimmer_frame = 0

    def _visible_titles(self) -> list[CollapsibleTitle]:
        """Titles the reader can actually see, in screen order.

        Textual's focus_next does not skip a title nested inside a collapsed
        block, which made Down appear stuck. A title qualifies here only if no
        block ABOVE it is collapsed — its own block being collapsed does not
        hide its title.
        """
        visible: list[CollapsibleTitle] = []
        for title in self.query(CollapsibleTitle):
            own = title.parent
            ancestor = own.parent if own is not None else None
            hidden = False
            while ancestor is not None:
                if isinstance(ancestor, Collapsible) and ancestor.collapsed:
                    hidden = True
                    break
                ancestor = ancestor.parent
            if not hidden:
                visible.append(title)
        return visible

    def _move(self, step: int) -> None:
        titles = self._visible_titles()
        if not titles:
            return
        current = self.focused
        if current in titles:
            target = titles[(titles.index(current) + step) % len(titles)]
        else:
            target = titles[0] if step > 0 else titles[-1]
        target.focus()
        target.scroll_visible(animate=False)

    def _focused_block(self) -> Collapsible | None:
        node = self.focused
        while node is not None:
            if isinstance(node, Collapsible):
                return node
            node = node.parent
        return None

    def action_next(self) -> None:
        self._move(1)

    def action_previous(self) -> None:
        self._move(-1)

    def action_open(self) -> None:
        # Already open: Right steps into the first item inside, which is what a
        # tree is expected to do.
        if (block := self._focused_block()) is not None:
            if block.collapsed:
                block.collapsed = False
            else:
                self._move(1)

    def action_close(self) -> None:
        # Already closed: Left steps back out to the item above.
        if (block := self._focused_block()) is not None:
            if not block.collapsed:
                block.collapsed = True
            else:
                self._move(-1)

    def action_toggle(self) -> None:
        if (block := self._focused_block()) is not None:
            block.collapsed = not block.collapsed

    def action_expand_all(self) -> None:
        for block in self.query(Collapsible):
            block.collapsed = False

    def action_collapse_all(self) -> None:
        for block in self.query(Collapsible):
            block.collapsed = True

    def action_reload(self) -> None:
        self.reload()


if __name__ == "__main__":
    # On Windows stdout starts out as cp1252 and the board's icons blow up the
    # encoding. A PowerShell launcher used to handle this; without one, the
    # script has to guarantee UTF-8 itself.
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")

    _theme, _argv = parse_theme(sys.argv)
    Board(find_board(_argv), theme=_theme).run()
