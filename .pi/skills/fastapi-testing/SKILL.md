---
name: fastapi-testing
description: Use when planning or writing tests for FastAPI routes - POST forms that redirect, 303 and 404 responses, and tests that change data the app keeps in memory.
---

# FastAPI route tests

Use `TestClient(app)` to test routes in process. Put runnable tests in the task that implements the behavior. Write the route tests in the route task and the rendered-page checks in the template task. Create each test file before running it.

## Redirect after a POST

- When a POST should redirect with 303, pass `status_code=303` to `RedirectResponse`. The default is 307.
- `TestClient` follows redirects. Pass `follow_redirects=False`, then assert `response.status_code == 303` and
  `response.headers["location"] == url`. Use a separate GET for checks on the rendered page.

## Unknown ids

- Raise `HTTPException(status_code=404)` when the route requires an existing record and its ID is unknown.
- Test the 404 next to a success test on the same route, so a missing route cannot pass.

## Shared data and ids

- For a shared module-level list, use an autouse fixture that takes a `deepcopy` before `yield` and restores the list in place with `items[:] = saved` afterward.
- Read the ID from the record under test. For a missing record, choose an ID outside the IDs in the fixture.

## Assertions on HTML

- Feed `response.text` into an HTML parser. Use the form's parsed `method` and `action` for the record under test.
- For a state change, check the same record before and after submission. Scope visible text checks to that record's rendered element.

### Form parser example

```python
from html.parser import HTMLParser


class FormParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.forms = []

    def handle_starttag(self, tag, attrs):
        if tag == "form":
            form = dict(attrs)
            method = (form.get("method") or "get").lower()
            self.forms.append((method, form.get("action")))


def form_targets(html):
    parser = FormParser()
    parser.feed(html)
    return parser.forms


assert form_targets("<form action='/records' method='POST'></form>") == [("post", "/records")]
```
