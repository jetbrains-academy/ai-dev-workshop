"""Opt-in Phase 4 acceptance and app checks for the workshop."""

import ast
from collections import Counter
from html.parser import HTMLParser
from pathlib import Path

import pytest
from fastapi.routing import APIRoute
from starlette.testclient import TestClient

import models
from app import app


class Element:
    def __init__(self, tag, attrs=()):
        self.tag = tag
        self.attrs = dict(attrs)
        self.children = []

    def select(self, predicate):
        return [self] * bool(predicate(self)) + [
            match
            for child in self.children
            if isinstance(child, Element)
            for match in child.select(predicate)
        ]

    @property
    def text(self):
        return " ".join(
            child.text if isinstance(child, Element) else child
            for child in self.children
        )


class Document(HTMLParser):
    def __init__(self, source):
        super().__init__()
        self.root = Element("document")
        self.stack = [self.root]
        self.feed(source)

    def handle_starttag(self, tag, attrs):
        node = Element(tag, attrs)
        self.stack[-1].children.append(node)
        if tag not in {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}:
            self.stack.append(node)

    def handle_endtag(self, tag):
        for index in range(len(self.stack) - 1, 0, -1):
            if self.stack[index].tag == tag:
                del self.stack[index:]
                break

    def handle_data(self, data):
        self.stack[-1].children.append(data)


def cards(source):
    return Document(source).root.select(
        lambda node: "card" in node.attrs.get("class", "").split()
    )


@pytest.fixture
def state():
    with TestClient(app) as client:
        seed = tuple(models.complaints)
        try:
            yield client, seed
        finally:
            models.complaints[:] = seed


def assert_layout(source):
    assert source.lstrip().lower().startswith("<!doctype html>")
    root = Document(source).root
    assert root.select(lambda n: n.tag == "html" and n.attrs.get("lang") == "en")
    for label, route in [("Home", "/"), ("Complaints", "/complaints")]:
        assert root.select(lambda n: n.tag == "a" and n.attrs.get("href") == route and label in n.text)
    assert "AgentClinic" in root.text


def test_prior_home_and_board(state):
    client, seed = state
    home = client.get("/")
    assert home.status_code == 200
    assert "Come in. Sit down. Tell us about your human." in home.text
    assert_layout(home.text)
    response = client.get("/complaints")
    assert response.status_code == 200
    assert "Complaints Board" in response.text
    assert_layout(response.text)
    assert 3 <= len(seed) <= 5
    assert any(item.text == "Scope creep never ends." for item in seed)
    for item in seed:
        assert any(
            item.agent_name in card.text and item.text in card.text
            and all(part in card.text for part in [str(item.timestamp.year), f"{item.timestamp.month:02}", f"{item.timestamp.day:02}"])
            for card in cards(response.text)
        )


def test_prior_positional_constructor_and_aware_timestamp(state):
    first = models.Complaint("first", "First complaint")
    second = models.Complaint("second", "Second complaint")
    assert (first.agent_name, first.text) == ("first", "First complaint")
    assert first.timestamp is not second.timestamp
    assert first.timestamp.utcoffset() is not None
    assert second.timestamp.utcoffset() is not None


def test_prior_add_form_and_redirect(state):
    client, _ = state
    root = Document(client.get("/complaints").text).root
    forms = root.select(lambda n: n.tag == "form")
    assert forms
    form = forms[-1]
    assert form.attrs.get("method", "get").lower() == "post"
    assert form.attrs.get("action") == "/complaints"
    assert form.select(lambda n: n.tag == "input" and n.attrs.get("name") == "agent_name" and n.attrs.get("type", "text") == "text")
    assert form.select(lambda n: n.tag == "textarea" and n.attrs.get("name") == "text")
    assert form.select(lambda n: (n.tag == "button" and n.attrs.get("type", "submit") == "submit") or (n.tag == "input" and n.attrs.get("type") == "submit"))
    old_count = len(models.complaints)
    response = client.post("/complaints", data={"agent_name": "Grader add", "text": "A new complaint."}, follow_redirects=False)
    assert response.status_code == 303
    assert response.headers["location"] == "/complaints"
    assert len(models.complaints) == old_count + 1
    assert models.complaints[-1].agent_name == "Grader add"
    assert models.complaints[-1].text == "A new complaint."
    assert "A new complaint." in client.get("/complaints").text


def test_identity_is_automatic_increasing_and_stable(state):
    first = models.Complaint("identity first", "First direct construction")
    second = models.Complaint("identity second", "Second direct construction")
    assert type(first.id) is int and type(second.id) is int
    assert second.id > first.id
    assert first.status == second.status == "open"
    identity = first.id
    first.status = "resolved"
    first.text = "Changed text"
    assert first.id == identity


def test_seed_ids_are_distinct(state):
    _, seed = state
    assert all(type(item.id) is int for item in seed)
    assert len({item.id for item in seed}) == len(seed)
    later = models.Complaint("later", "After seed")
    assert later.id > max(item.id for item in seed)


def test_deleted_highest_id_is_never_reused(state):
    item = models.Complaint("removed", "Highest id removed")
    models.complaints.append(item)
    models.complaints.remove(item)
    later = models.Complaint("replacement", "Must get a fresh id")
    assert later.id > item.id


def test_initial_card_offers_resolve(state):
    client, _ = state
    client.post("/complaints", data={"agent_name": "Grader initial", "text": "Initially open."}, follow_redirects=False)
    item = models.complaints[-1]
    matches = [card for card in cards(client.get("/complaints").text) if "Initially open." in card.text]
    assert len(matches) == 1 and "Open" in matches[0].text
    forms = matches[0].select(lambda n: n.tag == "form" and n.attrs.get("action") == f"/complaints/{item.id}/resolve" and n.attrs.get("method", "get").lower() == "post")
    assert any(form.select(lambda n: (n.tag == "button" and "Resolve" in n.text) or (n.tag == "input" and n.attrs.get("type") == "submit" and "Resolve" in n.attrs.get("value", ""))) for form in forms)


def test_resolve_reopen_forms_state_redirects_and_order(state):
    client, _ = state
    client.post("/complaints", data={"agent_name": "Grader resolve", "text": "Target complaint."}, follow_redirects=False)
    target = models.complaints[-1]
    identity = target.id
    before_ids = [item.id for item in models.complaints]
    def board_order():
        return [tuple(item.text for item in models.complaints if item.text in card.text) for card in cards(client.get("/complaints").text)]

    before_cards = board_order()
    for action, status, label, next_action, button in [
        ("resolve", "resolved", "Resolved", "reopen", "Reopen"),
        ("reopen", "open", "Open", "resolve", "Resolve"),
    ]:
        response = client.post(f"/complaints/{identity}/{action}", follow_redirects=False)
        assert response.status_code == 303
        assert response.headers["location"] == "/complaints"
        assert target.status == status and target.id == identity
        assert [item.id for item in models.complaints] == before_ids
        board_cards = cards(client.get("/complaints").text)
        assert board_order() == before_cards
        matches = [card for card in board_cards if "Target complaint." in card.text]
        assert len(matches) == 1 and label in matches[0].text
        forms = matches[0].select(lambda n: n.tag == "form" and n.attrs.get("action") == f"/complaints/{identity}/{next_action}" and n.attrs.get("method", "get").lower() == "post")
        assert forms
        assert any(form.select(lambda n: (n.tag == "button" and button in n.text and n.attrs.get("type", "submit") == "submit") or (n.tag == "input" and n.attrs.get("type") == "submit" and button in n.attrs.get("value", ""))) for form in forms)


@pytest.mark.parametrize(
    ("action", "initial_status"),
    [("resolve", "open"), ("reopen", "resolved")],
    ids=["resolve", "reopen"],
)
def test_unknown_id_returns_404(state, action, initial_status):
    client, _ = state
    complaint = models.Complaint("Grader missing ID", "Check an unknown complaint ID.")
    complaint.status = initial_status
    models.complaints.append(complaint)
    known_id = complaint.id
    unknown_id = max(item.id for item in models.complaints) + 1

    # Confirm the route is registered before testing how it handles a missing record.
    known = client.post(f"/complaints/{known_id}/{action}", follow_redirects=False)
    assert known.status_code == 303
    unknown = client.post(f"/complaints/{unknown_id}/{action}", follow_redirects=False)
    assert unknown.status_code == 404


def test_http_routes_are_registered_once():
    registrations = Counter(
        (method, route.path)
        for route in app.routes
        if isinstance(route, APIRoute)
        for method in route.methods
    )
    duplicates = [f"{method} {path}" for (method, path), count in registrations.items() if count > 1]
    assert not duplicates, f"Duplicate HTTP routes: {', '.join(sorted(duplicates))}"


def test_app_has_at_most_one_uvicorn_run_call():
    source = Path(__file__).resolve().parents[1] / "app.py"
    tree = ast.parse(source.read_text(encoding="utf-8"))
    lines = sorted(
        node.lineno
        for node in ast.walk(tree)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and node.func.attr == "run"
        and isinstance(node.func.value, ast.Name)
        and node.func.value.id == "uvicorn"
    )
    assert len(lines) <= 1, f"Duplicate uvicorn.run calls in app.py on lines {lines}"
