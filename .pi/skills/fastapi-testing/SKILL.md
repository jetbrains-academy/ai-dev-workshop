---
name: fastapi-testing
description: Use when planning or writing tests for FastAPI routes - POST forms that redirect, 303 and 404 responses, and tests that change data the app keeps in memory.
---

# FastAPI route tests

`tests/conftest.py` gives every test what it needs; a test file needs no imports or setup of its own.

- `client` is a `TestClient` that does not follow redirects, so a POST shows its 303. Check the page with a separate `client.get`.
- `form_targets(html)` lists the page's forms as `(method, action)` pairs.
- The app's in-memory data is restored after each test.
- A route that redirects after a POST returns `RedirectResponse(url, status_code=303)`; the default is 307.
- A route for an unknown id raises `HTTPException(status_code=404)`. Test it next to a success test on the same route.
- Put each test in the task that adds the code it checks: a test of page text goes in the task that changes the template.

```python
def test_add_redirects_and_lists(client, form_targets):
    response = client.post("/complaints", data={"agent_name": "Eve", "text": "Too many meetings."})
    assert response.status_code == 303
    assert response.headers["location"] == "/complaints"
    page = client.get("/complaints").text
    assert "Too many meetings." in page
    assert ("post", "/complaints") in form_targets(page)
```
