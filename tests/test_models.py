from models import Complaint, complaints


def test_complaint_ids_remain_unique_and_increase_after_removal():
    existing_ids = [complaint.id for complaint in complaints]
    assert all(type(complaint_id) is int for complaint_id in existing_ids)
    assert len(existing_ids) == len(set(existing_ids))

    first = Complaint("first", "First complaint")
    assert first.id > max(existing_ids)
    original_id = first.id
    first.text = "Updated complaint"
    assert first.id == original_id

    complaints.append(first)
    complaints.remove(first)
    second = Complaint("second", "Second complaint")
    assert second.id > original_id
