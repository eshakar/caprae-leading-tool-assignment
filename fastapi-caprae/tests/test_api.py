from app.db.seed import SAMPLES


def test_health_and_seed(client):
    assert client.get("/api/health").json() == {"status": "ok"}
    stats = client.get("/api/stats").json()
    assert stats["total"] == len(SAMPLES)
    assert sum(stats["by_tier"].values()) == len(SAMPLES)
    assert len(stats["score_distribution"]) == 10


def test_list_filter_sort_paginate(client):
    page = client.get("/api/leads", params={"page_size": 5, "sort": "-score"}).json()
    scores = [i["score"] for i in page["items"]]
    assert scores == sorted(scores, reverse=True) and page["total"] == len(SAMPLES)
    hvac = client.get("/api/leads", params={"industry": "HVAC", "state": "TX"}).json()
    assert hvac["total"] >= 1 and all(i["industry"] == "HVAC" and i["state"] == "TX" for i in hvac["items"])
    hot = client.get("/api/leads", params={"tier": "hot"}).json()
    assert all(i["score_tier"] == "hot" for i in hot["items"])
    assert client.get("/api/leads", params={"search": "Lone Star"}).json()["total"] == 1
    assert client.get("/api/leads", params={"sort": "bogus"}).status_code == 422


def test_create_update_dedupe_delete(client):
    r = client.post("/api/leads", json={"company_name": "Test Mechanical LLC", "domain": "https://www.testmech.example/x",
                                        "industry": "HVAC", "state": "texas", "email": "owner@mailinator.com",
                                        "auto_enrich": False})
    assert r.status_code == 201, r.text
    lead = r.json()
    assert lead["domain"] == "testmech.example" and lead["state"] == "TX"
    assert lead["emails"][0]["status"] == "invalid"
    assert lead["score_breakdown"] and lead["next_action"]

    # Same domain again -> returns the existing record instead of a duplicate
    dup = client.post("/api/leads", json={"domain": "testmech.example", "auto_enrich": False})
    assert dup.status_code == 200 and dup.headers["X-Duplicate-Of"] == str(lead["id"])
    # Same canonical company name -> also a duplicate
    dup2 = client.post("/api/leads", json={"company_name": "TEST MECHANICAL, INC.", "auto_enrich": False})
    assert dup2.json()["id"] == lead["id"]

    upd = client.patch(f"/api/leads/{lead['id']}", json={"stage": "contacted", "employee_count": 50, "notes": "Called"})
    assert upd.status_code == 200 and upd.json()["stage"] == "contacted" and upd.json()["notes"] == "Called"
    assert client.patch(f"/api/leads/{lead['id']}", json={"stage": "nope"}).status_code == 422

    assert client.delete(f"/api/leads/{lead['id']}").status_code == 204
    assert client.get(f"/api/leads/{lead['id']}").status_code == 404


def test_create_validation(client):
    assert client.post("/api/leads", json={"domain": "not a domain"}).status_code == 422
    assert client.post("/api/leads", json={}).status_code == 422


def test_csv_import_merges_and_export(client):
    csv_body = (
        "Company,Website,Industry,State,Employees,Annual Revenue,Founded,Owner,Email\n"
        "Fresh Air Co,freshair.example,HVAC,TX,25,$5M,1990,Ann Lee,ann@freshair.example\n"
        "Fresh Air Co,freshair.example,HVAC,TX,25,$5M,1990,Ann Lee,ann@freshair.example\n"
        "Lone Star Comfort HVAC,,HVAC,TX,,,,,\n"
        ",,,,,,,,\n"
    )
    r = client.post("/api/leads/import", files={"file": ("leads.csv", csv_body, "text/csv")})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["created"] == 1 and body["merged"] == 1 and body["skipped"] == 2
    assert body["columns_mapped"]["revenue_usd"] == "Annual Revenue"

    bad = client.post("/api/leads/import", files={"file": ("x.csv", "foo,bar\n1,2\n", "text/csv")})
    assert bad.status_code == 400

    for fmt, header in (("standard", "company_name"), ("hubspot", "Company name"), ("salesforce", "Company")):
        exp = client.get("/api/leads/export", params={"format": fmt, "tier": "hot"})
        assert exp.status_code == 200 and exp.text.startswith(header)
        assert "attachment" in exp.headers["content-disposition"]


def test_icp_update_rescores(client):
    icp = client.get("/api/icp").json()
    before = client.get("/api/leads", params={"search": "Midwest Precision"}).json()["items"][0]["score"]
    icp["target_industries"] = icp["target_industries"] + ["Manufacturing"]
    icp["target_states"] = icp["target_states"] + ["oh"]
    r = client.put("/api/icp", json=icp)
    assert r.status_code == 200 and "OH" in r.json()["target_states"]
    after = client.get("/api/leads", params={"search": "Midwest Precision"}).json()["items"][0]["score"]
    assert after > before
    bad = dict(icp, min_employees=500, max_employees=10)
    assert client.put("/api/icp", json=bad).status_code == 422
    assert client.put("/api/icp", json=dict(icp, weights={"bogus": 5})).status_code == 422


def test_outreach_template_fallback(client):
    lead_id = client.get("/api/leads", params={"page_size": 1}).json()["items"][0]["id"]
    assert client.get("/api/ai/status").json()["enabled"] is False
    r = client.post(f"/api/leads/{lead_id}/outreach", json={"goal": "acquisition", "tone": "warm"})
    assert r.status_code == 201, r.text
    d = r.json()
    assert d["generator"] == "template" and d["subject"] and d["email_body"]
    assert len(client.get(f"/api/leads/{lead_id}/outreach").json()) == 1
    assert client.post("/api/leads/999999/outreach", json={}).status_code == 404


def test_bulk_stage_and_job_endpoints(client):
    ids = [i["id"] for i in client.get("/api/leads", params={"page_size": 3}).json()["items"]]
    assert client.post("/api/leads/bulk/stage", json={"ids": ids, "stage": "replied"}).json()["updated"] <= 3
    assert all(client.get(f"/api/leads/{i}").json()["stage"] == "replied" for i in ids)
    # Already in the target stage -> nothing changes, nothing is logged twice.
    assert client.post("/api/leads/bulk/stage", json={"ids": ids, "stage": "replied"}).json()["updated"] == 0
    assert client.get("/api/leads/jobs/does-not-exist").status_code == 404
    assert client.post("/api/leads/enrich", json={"ids": [999999]}).status_code == 404
    assert client.post("/api/leads/enrich", json={"ids": []}).status_code == 422


def test_dedupe_merges_name_duplicates(client):
    a = client.post("/api/leads", json={"company_name": "Twin Peaks Plumbing", "auto_enrich": False}).json()
    # Bypass create-time dedupe by giving the second a different name, then rename it to collide.
    b = client.post("/api/leads", json={"company_name": "Twin Peaks Temp", "phone": "512-555-0111",
                                        "auto_enrich": False}).json()
    client.patch(f"/api/leads/{b['id']}", json={"company_name": "Twin Peaks Plumbing LLC"})
    assert any(any(x["id"] == a["id"] for x in g) for g in client.get("/api/leads/duplicates").json())
    res = client.post("/api/leads/dedupe").json()
    assert res["records_removed"] >= 1
    merged = client.get(f"/api/leads/{a['id']}").json()
    assert merged["phone"] == "(512) 555-0111"


def test_stage_change_schedules_follow_up_and_logs_timeline(client):
    lead = client.post("/api/leads", json={"company_name": "Timeline HVAC", "industry": "HVAC", "state": "TX",
                                           "auto_enrich": False}).json()
    assert lead["follow_up_at"] is None and lead["follow_up_due"] is False

    contacted = client.patch(f"/api/leads/{lead['id']}", json={"stage": "contacted"}).json()
    assert contacted["last_contacted_at"] and contacted["follow_up_at"]
    assert contacted["follow_up_due"] is False

    # An explicit past date makes the follow-up due and changes the next best action.
    due = client.patch(f"/api/leads/{lead['id']}", json={"follow_up_at": "2020-01-01T09:00:00Z"}).json()
    assert due["follow_up_due"] is True and "Follow-up is due" in due["next_action"]
    listed = client.get("/api/leads", params={"follow_up_due": True}).json()
    assert any(i["id"] == lead["id"] and i["follow_up_due"] for i in listed["items"])

    client.patch(f"/api/leads/{lead['id']}", json={"notes": "Owner prefers calls", "employee_count": 40})
    won = client.patch(f"/api/leads/{lead['id']}", json={"stage": "won"}).json()
    assert won["follow_up_at"] is None  # closing a lead clears its follow-up

    kinds = [a["kind"] for a in client.get(f"/api/leads/{lead['id']}/activities").json()]
    assert kinds[-1] == "created"
    assert {"stage", "follow_up", "note", "edited"} <= set(kinds)
    assert client.get("/api/leads/999999/activities").status_code == 404


def test_action_center(client):
    actions = client.get("/api/leads/actions/today").json()
    assert set(actions) == {"follow_ups_due", "upcoming", "hot_untouched"}
    # Seed data contains overdue follow-ups and hot leads nobody has contacted yet.
    assert actions["follow_ups_due"] and all(a["days_overdue"] >= 0 for a in actions["follow_ups_due"])
    assert all(a["score_tier"] == "hot" and a["stage"] == "new" for a in actions["hot_untouched"])


def test_outreach_is_logged(client):
    lead_id = client.get("/api/leads", params={"page_size": 1, "stage": "new"}).json()["items"][0]["id"]
    client.post(f"/api/leads/{lead_id}/outreach", json={"goal": "sales", "tone": "direct"})
    assert client.get(f"/api/leads/{lead_id}/activities").json()[0]["kind"] == "outreach"
