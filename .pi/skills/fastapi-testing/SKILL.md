---
name: fastapi-testing
description: Use when planning or writing tests for FastAPI routes - POST forms that redirect, 303 and 404 responses, and tests that change data the app keeps in memory.
---

# FastAPI route tests

When you write an implementation plan, write its test code this way, so execution does not have to rediscover it.

## Redirect after a POST

- Return `RedirectResponse(url, status_code=303)`. The default is 307.
- `TestClient` follows redirects. Pass `follow_redirects=False`, then assert `response.status_code == 303` and
  `response.headers["location"] == url`. Check the page with a separate `client.get(url)`.

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
- Assert on distinctive markup such as a form's `action`, not a bare word: "Archive" is also inside "Archived".

## Example

```python
import copy

import pytest
from fastapi.testclient import TestClient  # same class as starlette.testclient; keep the project's import

from app import app
from models import orders  # the module-level list the app reads

client = TestClient(app)


@pytest.fixture(autouse=True)
def restore_orders():
    saved = copy.deepcopy(orders)
    yield
    orders[:] = saved


def test_archive_redirects_and_removes_the_form():
    order_id = orders[0].id
    response = client.post(f"/orders/{order_id}/archive", follow_redirects=False)
    assert response.status_code == 303
    assert response.headers["location"] == "/orders"
    assert f'action="/orders/{order_id}/archive"' not in client.get("/orders").text


def test_archive_unknown_id_is_404():
    unknown = max(o.id for o in orders) + 1000
    response = client.post(f"/orders/{unknown}/archive", follow_redirects=False)
    assert response.status_code == 404
```

Check routes in process like this; never start a server.
