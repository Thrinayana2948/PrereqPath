"""Combines graph building, Kahn's algorithm and DFS cycle analysis into one report."""
from collections import Counter, defaultdict, deque
from typing import Iterable

from .cycles import cycle_groups, find_cycles
from .graph import build_graph
from .kahn import kahn_topological_sort


def _reachable(adjacency: dict[str, list[str]], sources: Iterable[str]) -> set[str]:
    seen, queue = set(sources), deque(sources)
    while queue:
        for v in adjacency[queue.popleft()]:
            if v not in seen:
                seen.add(v)
                queue.append(v)
    return seen


def analyze(courses: Iterable[str], prerequisites: Iterable[tuple[str, str]]) -> dict:
    """Return a JSON-serialisable analysis. Raises GraphValidationError for invalid input."""
    graph = build_graph(courses, prerequisites)
    known = graph.adjacency

    # Each unknown prerequisite of a known course is a requirement that can never be met.
    missing_for = defaultdict(list)
    for edge in graph.unresolved:
        if edge["dependent"] in known and edge["prerequisite"] not in known:
            missing_for[edge["dependent"]].append(edge["prerequisite"])
    extra = Counter({course: len(codes) for course, codes in missing_for.items()})

    kahn = kahn_topological_sort(graph, extra)
    cycles = find_cycles(graph)
    groups = cycle_groups(graph)
    members = {c for g in groups for c in g}
    eligible = set(kahn.order)

    behind_cycle = _reachable(known, members)
    behind_unresolved = _reachable(known, missing_for)
    blocked = []
    for course in graph.vertices:
        if course in eligible or course in members:
            continue
        reasons = []
        if course in behind_cycle:
            reasons.append("cycle")
        if course in behind_unresolved:
            reasons.append("unresolved_prerequisite")
        waiting_on = [p for p in graph.reverse[course] if p not in eligible] + missing_for[course]
        blocked.append({"course": course, "reasons": reasons, "waiting_on": waiting_on})

    is_complete = not graph.unresolved and len(kahn.order) == len(graph.vertices)
    return {
        "summary": {
            "total_courses": len(graph.vertices),
            "total_prerequisites": graph.edge_count,
            "ordered_courses": len(kahn.order),
            "cycle_members": len(members),
            "blocked_courses": len(blocked),
            "unresolved_references": len(graph.unresolved),
            "duplicate_edges": len(graph.duplicate_edges),
            "has_cycle": bool(cycles),
            "is_complete": is_complete,
        },
        "order": kahn.order,
        "complete_order": kahn.order if is_complete else None,
        "levels": kahn.levels,
        "initial_indegree": kahn.initial_indegree,
        "trace": kahn.trace,
        "cycles": cycles,
        "cycle_groups": groups,
        "cycle_members": sorted(members),
        "blocked": blocked,
        "unresolved": graph.unresolved,
        "duplicate_edges": [list(e) for e in graph.duplicate_edges],
    }
