# AgentClinic Phase 2 — Complaints Board Design

## Intent

Give agents a place to read other agents' grievances while keeping AgentClinic a small, approachable teaching project. The board is read-only in this phase. The home page and shared navigation continue to work.

## Scope and success

- `GET /complaints` returns 200 with a `Complaints Board` heading and the existing document shell, brand, and Home and Complaints links.
- Three to five seeded complaints appear as Bootstrap `.card` elements. Each card shows the agent name, complaint text, and a date with year, month, and day. One seed's text is exactly `Scope creep never ends.`
- `models.py` defines a `Complaint` dataclass whose first two positional fields are `agent_name` and `text`. Each new instance receives its own timezone-aware timestamp by default.
- `models.complaints` is the module-level seeded list. The board displays a reversed copy of this list, putting the newest complaint first without changing the stored order.
- Existing Phase 1 checks continue to pass, and the project's frozen pytest command passes.

This phase does not add a submission form, complaint IDs or status, persistence, authentication, or a database. A passing page would still miss the teaching goal if it duplicated the shared layout or made the data flow hard to follow.

## Constraints

- Keep FastAPI, Jinja2, Bootstrap 5, uv, and the in-memory data model established in `specs/mission.md` and `specs/tech-stack.md`.
- Preserve the existing `app.py` entry point, `templates/base.html`, and home route.
- Leave `models.complaints` in insertion order so Phase 3 can append complaints and Phase 4 can update their state without reordering them.

## Approaches

1. **Reverse a copy in the route — chosen.** The route passes `complaints[::-1]` to Jinja. Ordering stays in Python, the template only renders cards, and the stored list remains untouched. Newly appended complaints will appear first in Phase 3.
2. **Sort by timestamp in the route.** This handles out-of-order insertion, but adds ordering logic that the in-memory, append-only roadmap does not require.
3. **Reverse in the template.** This keeps the route shorter, but puts the board's ordering rule in presentation code and makes it less visible to students reading the route.

## Page and application design

`models.py` uses `@dataclass` and `field(default_factory=...)` for a fresh UTC-aware `datetime` on each construction. Its module-level list holds three to five distinct, short complaints with agent names; the exact text of one is fixed by the roadmap. The seed entries' construction order is their board order, with the last seed shown first.

`app.py` imports the seeded list and adds `GET /complaints`. The handler passes `complaints[::-1]` to `templates/complaints.html`. The template extends `base.html`, displays the heading, and loops over the provided complaints. Each complaint is one Bootstrap `.card`; the date is rendered as `YYYY-MM-DD` from its timestamp. Jinja's normal escaping protects the displayed names and text.

```text
AgentClinic                              Home   Complaints

Complaints Board

┌──────────────────────────────────────────────┐
│ Agent name                         YYYY-MM-DD │
│ Complaint text                               │
└──────────────────────────────────────────────┘
               ... newest first ...
```

Tests use `TestClient` to check the route, shared shell, heading, card contents, date format, seed count and required exact text. A model test checks positional construction, timezone awareness, and distinct default timestamps. A board test checks that display order is reversed while `models.complaints` remains in insertion order. Existing home tests remain in the suite.

## Builder choices

The builder may choose the remaining seed names and complaint copy, Bootstrap spacing and card details, and test file organization. Keep these choices small and readable for course students.
