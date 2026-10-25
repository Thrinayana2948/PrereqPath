"""Kahn's topological sort with indegree tracking and a FIFO queue, implemented from scratch."""
from collections import deque
from dataclasses import dataclass

from .graph import CourseGraph


@dataclass
class KahnResult:
    order: list[str]                 # courses that became eligible, in processing order
    trace: list[dict]                # one entry per dequeued course
    initial_indegree: dict[str, int]
    levels: dict[str, int]           # earliest "term" index for each ordered course
    remaining: list[str]             # courses never reaching indegree 0


def kahn_topological_sort(graph: CourseGraph, extra_indegree: dict[str, int] | None = None) -> KahnResult:
    """Run Kahn's algorithm in O(V + E) time and O(V) auxiliary space.

    `extra_indegree` adds unsatisfiable requirements (e.g. unresolved prerequisite
    codes) so those courses and everything downstream never become eligible.
    """
    extra = extra_indegree or {}
    indegree = {v: len(graph.reverse[v]) + extra.get(v, 0) for v in graph.vertices}
    initial = dict(indegree)
    level = {v: 0 for v in graph.vertices}

    queue = deque(v for v in graph.vertices if indegree[v] == 0)
    order, trace = [], []
    while queue:
        u = queue.popleft()
        order.append(u)
        decremented, enqueued = [], []
        for v in graph.adjacency[u]:
            indegree[v] -= 1
            level[v] = max(level[v], level[u] + 1)
            decremented.append({"course": v, "indegree": indegree[v]})
            if indegree[v] == 0:
                queue.append(v)
                enqueued.append(v)
        trace.append({
            "step": len(order),
            "dequeued": u,
            "decremented": decremented,
            "enqueued": enqueued,
            "queue": list(queue),
        })

    done = set(order)
    return KahnResult(
        order=order,
        trace=trace,
        initial_indegree=initial,
        levels={v: level[v] for v in order},
        remaining=[v for v in graph.vertices if v not in done],
    )
