from copy import deepcopy
from html.parser import HTMLParser
from itertools import count

import pytest
from starlette.testclient import TestClient

import models
from app import app


@pytest.fixture(autouse=True)
def restore_complaints():
    """Each test starts from the seeded complaints and the next free ID, whatever earlier tests changed."""
    saved = deepcopy(models.complaints)
    yield
    models.complaints[:] = saved
    if hasattr(models, "_complaint_ids"):
        models._complaint_ids = count(max((complaint.id for complaint in saved), default=0) + 1)


@pytest.fixture
def client():
    """A test client that returns redirects instead of following them, so a POST shows its 303."""
    return TestClient(app, follow_redirects=False)


class _FormParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.forms = []

    def handle_starttag(self, tag, attrs):
        if tag == "form":
            form = dict(attrs)
            self.forms.append(((form.get("method") or "get").lower(), form.get("action")))


@pytest.fixture
def form_targets():
    """`form_targets(html)` lists each form on a page as `(method, action)`, e.g. `("post", "/complaints")`."""

    def parse(html):
        parser = _FormParser()
        parser.feed(html)
        return parser.forms

    return parse
