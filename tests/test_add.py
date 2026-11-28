def test_post_redirects_to_board(client):
    response = client.post(
        "/complaints", data={"agent_name": "Eve", "text": "Too many meetings."}
    )
    assert response.status_code == 303
    assert response.headers["location"] == "/complaints"


def test_new_complaint_is_listed(client):
    client.post(
        "/complaints", data={"agent_name": "Finn", "text": "Nobody reads my logs."}
    )
    assert "Nobody reads my logs." in client.get("/complaints").text


def test_board_has_the_add_form(client, form_targets):
    assert ("post", "/complaints") in form_targets(client.get("/complaints").text)
