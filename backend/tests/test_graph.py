import pytest

from app.graph import (
    GraphValidationError, analyze, build_graph, cycle_groups, find_cycles, kahn_topological_sort,
)


def assert_respects_edges(order, edges):
    pos = {c: i for i, c in enumerate(order)}
    for pre, dep in edges:
        assert pos[pre] < pos[dep], f"{pre} must come before {dep}"


def test_valid_dag_orders_prerequisites_first():
    courses = ["CS101", "CS102", "CS201", "CS202", "CS301"]
    edges = [("CS101", "CS102"), ("CS102", "CS201"), ("CS101", "CS202"),
             ("CS201", "CS301"), ("CS202", "CS301")]
    r = analyze(courses, edges)
    assert r["summary"]["is_complete"] is True
    assert r["complete_order"] == r["order"]
    assert sorted(r["order"]) == sorted(courses)
    assert_respects_edges(r["order"], edges)
    assert r["cycles"] == [] and r["blocked"] == [] and r["unresolved"] == []
    assert r["levels"] == {"CS101": 0, "CS102": 1, "CS202": 1, "CS201": 2, "CS301": 3}


def test_kahn_trace_records_queue_processing():
    g = build_graph(["A", "B", "C"], [("A", "B"), ("A", "C")])
    k = kahn_topological_sort(g)
    assert k.initial_indegree == {"A": 0, "B": 1, "C": 1}
    first = k.trace[0]
    assert first["dequeued"] == "A"
    assert first["enqueued"] == ["B", "C"]
    assert first["queue"] == ["B", "C"]
    assert [s["dequeued"] for s in k.trace] == ["A", "B", "C"]


def test_independent_courses_all_ordered_at_level_zero():
    r = analyze(["MATH1", "ART1", "BIO1"], [])
    assert r["order"] == ["ART1", "BIO1", "MATH1"]  # deterministic (sorted) tie-breaking
    assert set(r["levels"].values()) == {0}
    assert r["summary"]["is_complete"]


def test_empty_graph():
    r = analyze([], [])
    assert r["order"] == [] and r["trace"] == []
    assert r["summary"]["total_courses"] == 0
    assert r["summary"]["is_complete"] is True


def test_disconnected_components():
    edges = [("A", "B"), ("X", "Y"), ("Y", "Z")]
    r = analyze(["A", "B", "X", "Y", "Z", "SOLO"], edges)
    assert r["summary"]["is_complete"]
    assert len(r["order"]) == 6
    assert_respects_edges(r["order"], edges)


def test_cycle_members_distinguished_from_downstream_blocked():
    # A -> B -> C -> A is a cycle; D depends on C; E depends on D; F is independent.
    edges = [("A", "B"), ("B", "C"), ("C", "A"), ("C", "D"), ("D", "E")]
    r = analyze(["A", "B", "C", "D", "E", "F"], edges)
    assert r["summary"]["has_cycle"] is True
    assert r["summary"]["is_complete"] is False
    assert r["complete_order"] is None
    assert r["cycle_members"] == ["A", "B", "C"]
    assert r["cycle_groups"] == [["A", "B", "C"]]
    blocked = {b["course"]: b for b in r["blocked"]}
    assert set(blocked) == {"D", "E"}
    assert blocked["D"]["reasons"] == ["cycle"] and blocked["D"]["waiting_on"] == ["C"]
    assert blocked["E"]["waiting_on"] == ["D"]
    assert r["order"] == ["F"]
    assert any(set(c[:-1]) == {"A", "B", "C"} and c[0] == c[-1] for c in r["cycles"])


def test_scc_membership_catches_cross_edge_member():
    # C is on cycle C -> B -> A -> C, but DFS from A reaches C only after B is finished.
    g = build_graph(["A", "B", "C"], [("A", "B"), ("A", "C"), ("B", "A"), ("C", "B")])
    assert cycle_groups(g) == [["A", "B", "C"]]
    assert find_cycles(g)  # DFS colouring independently detects a cycle


def test_two_separate_cycles_and_course_between_them():
    edges = [("A", "B"), ("B", "A"), ("B", "M"), ("M", "X"), ("X", "Y"), ("Y", "X")]
    r = analyze(["A", "B", "M", "X", "Y"], edges)
    assert r["cycle_groups"] == [["A", "B"], ["X", "Y"]]
    assert [b["course"] for b in r["blocked"]] == ["M"]


def test_dfs_and_kahn_agree_on_acyclicity():
    g = build_graph(["A", "B", "C"], [("A", "B"), ("B", "C")])
    assert find_cycles(g) == [] and cycle_groups(g) == []
    assert kahn_topological_sort(g).remaining == []


def test_unresolved_prerequisite_blocks_course_and_dependents():
    edges = [("GHOST", "B"), ("A", "B"), ("B", "C")]
    r = analyze(["A", "B", "C"], edges)
    assert r["unresolved"] == [{"prerequisite": "GHOST", "dependent": "B", "missing": ["GHOST"]}]
    assert r["summary"]["is_complete"] is False and r["complete_order"] is None
    assert r["order"] == ["A"]
    assert r["cycle_members"] == []
    blocked = {b["course"]: b for b in r["blocked"]}
    assert blocked["B"]["reasons"] == ["unresolved_prerequisite"]
    assert blocked["B"]["waiting_on"] == ["GHOST"]
    assert blocked["C"]["waiting_on"] == ["B"]
    assert r["initial_indegree"]["B"] == 2


def test_unknown_dependent_reported_and_prevents_complete_order():
    r = analyze(["A"], [("A", "NOPE")])
    assert r["unresolved"][0]["missing"] == ["NOPE"]
    assert r["order"] == ["A"]
    assert r["summary"]["is_complete"] is False


def test_duplicate_course_rejected():
    with pytest.raises(GraphValidationError, match="Duplicate course"):
        build_graph(["A", "A"], [])


def test_duplicate_edges_counted_once():
    r = analyze(["A", "B"], [("A", "B"), ("A", "B")])
    assert r["duplicate_edges"] == [["A", "B"]]
    assert r["summary"]["total_prerequisites"] == 1
    assert r["initial_indegree"]["B"] == 1
    assert r["summary"]["is_complete"]


def test_self_dependency_rejected():
    with pytest.raises(GraphValidationError, match="own prerequisite"):
        build_graph(["A"], [("A", "A")])


@pytest.mark.parametrize("bad", ["", "   ", None, 5])
def test_blank_or_non_string_codes_rejected(bad):
    with pytest.raises(GraphValidationError):
        build_graph([bad], [])


def test_long_chain_does_not_hit_recursion_limit():
    n = 5000
    courses = [f"C{i}" for i in range(n)]
    edges = [(courses[i], courses[i + 1]) for i in range(n - 1)]
    r = analyze(courses, edges)
    assert r["order"] == courses and r["summary"]["is_complete"]
