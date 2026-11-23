---
name: fastapi
description: Use when planning, implementing, or reviewing FastAPI routes, TestClient tests, or FastAPI and Starlette compatibility.
---

# FastAPI

## Use the installed API

Check the project's pinned FastAPI, Starlette, and HTTPX versions before copying an import or signature from an example. Verify a suspect import with the interpreter that runs the tests. Import `TestClient` from `fastapi.testclient`. Projects that already import it from `starlette.testclient` can keep that path.

For deprecation warnings, locate the file that uses the deprecated API. Update application calls to a supported signature. If the call is inside a dependency, check that dependency's compatibility with the locked versions and report it separately from application failures.

## Routes and tests

Use `{report_id}` in the route and a matching typed argument `report_id: int` in the handler. Return 404 when a valid identifier has no matching resource. Pair an unknown-ID test with a successful request to the same route so an unregistered route cannot satisfy the checks.

With `TestClient`, pass `follow_redirects=False` on the request when checking a redirect. Assert the status code and `Location` header. Set the response status explicitly when the contract calls for 303.

A new `TestClient` still uses the same application state. Give tests that mutate shared state fresh data through a pytest fixture, or have the fixture restore the original state in teardown, including changes to objects stored in shared collections. Each test should pass by itself and in any order.

```python
from fastapi import FastAPI, HTTPException
from fastapi.responses import RedirectResponse
from fastapi.testclient import TestClient

app = FastAPI()


@app.post("/reports/{report_id}/export")
def export_report(report_id: int) -> RedirectResponse:
    if report_id != 1:
        raise HTTPException(status_code=404, detail="Report not found")
    return RedirectResponse("/downloads/report-1.csv", status_code=303)


def test_report_export():
    with TestClient(app) as client:
        known = client.post("/reports/1/export", follow_redirects=False)
        unknown = client.post("/reports/999/export", follow_redirects=False)

    assert known.status_code == 303
    assert known.headers["location"] == "/downloads/report-1.csv"
    assert unknown.status_code == 404
```

## When to serve the app

Use `TestClient` for in-process route checks. Start Uvicorn only for an intentional live preview or a check that requires a real network connection, when the project allows it. A foreground server occupies the shell until it stops. If you start a server for a check, stop that process when finished.
