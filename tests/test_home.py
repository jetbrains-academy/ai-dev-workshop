from html.parser import HTMLParser

from starlette.testclient import TestClient

from app import app


TAGLINE = "Come in. Sit down. Tell us about your human."


class NavigationParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.text = []
        self.links = []
        self._in_nav = False
        self._link_href = None
        self._link_text = []

    def handle_starttag(self, tag, attrs):
        if tag == "nav":
            self._in_nav = True
        if self._in_nav and tag == "a":
            self._link_href = dict(attrs).get("href")
            self._link_text = []

    def handle_endtag(self, tag):
        if tag == "a" and self._link_href is not None:
            label = " ".join("".join(self._link_text).split())
            self.links.append((label, self._link_href))
            self._link_href = None
        if tag == "nav":
            self._in_nav = False

    def handle_data(self, data):
        if self._in_nav:
            self.text.append(data)
        if self._link_href is not None:
            self._link_text.append(data)


def test_home_page():
    response = TestClient(app).get("/")

    assert response.status_code == 200
    assert response.headers["content-type"].split(";")[0] == "text/html"
    assert response.text.startswith("<!DOCTYPE html>")
    assert '<html lang="en">' in response.text
    assert TAGLINE in response.text

    navigation = NavigationParser()
    navigation.feed(response.text)
    assert "AgentClinic" in "".join(navigation.text)
    assert ("Home", "/") in navigation.links
    assert ("Complaints", "/complaints") in navigation.links


def test_home_with_query_string():
    response = TestClient(app).get("/?source=course")

    assert response.status_code == 200
    assert TAGLINE in response.text
