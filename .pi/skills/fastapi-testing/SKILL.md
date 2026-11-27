---
name: fastapi-testing
description: Use when planning or writing tests for FastAPI routes - POST forms that redirect, 303 and 404 responses, and tests that change data the app keeps in memory.
---

# FastAPI route tests

When you write an implementation plan, write its test code this way, so execution does not have to rediscover it.
Write and run the route tests in the task that adds the route. Check the rendered board in the template task.

## Redirect after a POST

- Return `RedirectResponse(url, status_code=303)`. The default is 307.
- `TestClient` follows redirects. Pass `follow_redirects=False`, then assert `response.status_code == 303` and
  `response.headers["location"] == url`. Use a separate GET for checks on the rendered page.

## Unknown ids

- Raise `HTTPException(status_code=404)` when no record has the id.
- Test the 404 next to a success test on the same route, so a missing route cannot pass.

## Shared data and ids

- Data in a module-level list is shared by every test. Restore it with an autouse fixture that saves a deep copy and
  puts it back in place (`items[:] = saved`). Rebinding the name, or clearing and re-adding records, leaves the app on
  different objects with new ids.
- Never assume an id such as `1`. Read it from a record (`items[0].id`), or create the record in the test.
  For an unknown id use one that cannot exist: `max(i.id for i in items) + 1000`.

## Assertions on HTML

- Use `response.text`, not `response.content`, which is bytes.
- Parse the form's `method` and `action` for the test complaint's assigned ID. Check the form before submission and again after it.

## Route task example

```python
import copy

import pytest
from starlette.testclient import TestClient

from app import app
from models import complaints

client = TestClient(app)


@pytest.fixture(autouse=True)
def restore_complaints():
    saved = copy.deepcopy(complaints)
    yield
    complaints[:] = saved


def test_resolve_redirects_and_updates_complaint():
    complaint = complaints[0]
    response = client.post(f"/complaints/{complaint.id}/resolve", follow_redirects=False)
    assert response.status_code == 303
    assert response.headers["location"] == "/complaints"
    assert complaint.resolved is True


def test_resolve_unknown_id_is_404():
    unknown = max(complaint.id for complaint in complaints) + 1000
    response = client.post(f"/complaints/{unknown}/resolve", follow_redirects=False)
    assert response.status_code == 404
```

## Template task example

Add this form check to the same test module so it uses the fixture above. Also check that the same card remains and shows **Closed**.

```python
from html.parser import HTMLParser

from models import Complaint


class FormParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.forms = []

    def handle_starttag(self, tag, attrs):
        if tag == "form":
            form = dict(attrs)
            method = (form.get("method") or "get").lower()
            self.forms.append((method, form.get("action")))


def board_forms():
    response = client.get("/complaints")
    assert response.status_code == 200
    parser = FormParser()
    parser.feed(response.text)
    return parser.forms


def test_resolve_form_for_new_complaint():
    complaint = Complaint("Tess", "Check the resolve form.")
    complaints.append(complaint)
    action = f"/complaints/{complaint.id}/resolve"

    assert ("post", action) in board_forms()
    response = client.post(action, follow_redirects=False)
    assert response.status_code == 303
    assert all(form_action != action for _, form_action in board_forms())
```

Check routes in process like this; never start a server.
