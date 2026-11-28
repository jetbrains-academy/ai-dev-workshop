def test_board_lists_complaints(client):
    response = client.get("/complaints")
    assert response.status_code == 200
    assert "Scope creep never ends." in response.text
