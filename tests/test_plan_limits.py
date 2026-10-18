from app.services.limits import default_limits, normalize_plan


def test_free_plan_budget_is_one_dollar():
    assert default_limits("free")["budget_usd"] == 1


def test_pro_plan_budget_is_fifteen_dollars():
    assert default_limits("pro")["budget_usd"] == 15


def test_only_explicit_pro_plan_receives_pro_limits():
    for plan in (None, "", "free", "max", "MAX", "admin", "unknown"):
        assert normalize_plan(plan) == "free"
        assert default_limits(plan)["budget_usd"] == 1


def test_plan_name_is_normalized_case_insensitively():
    assert normalize_plan(" Pro ") == "pro"
    assert default_limits(" Pro ")["budget_usd"] == 15
