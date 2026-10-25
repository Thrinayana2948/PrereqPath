"""Directed course graph. Vertices are course codes; an edge points prerequisite -> dependent.

Pure Python: no database, web framework, or graph library dependencies.
"""
from dataclasses import dataclass, field
from typing import Iterable


class GraphValidationError(ValueError):
    """Structurally invalid input: blank codes, duplicate courses, or self-dependencies."""


@dataclass
class CourseGraph:
    vertices: list[str]                      # unique course codes, sorted
    adjacency: dict[str, list[str]]          # prerequisite -> dependents (resolved edges only)
    reverse: dict[str, list[str]]            # dependent -> prerequisites (resolved edges only)
    unresolved: list[dict] = field(default_factory=list)       # edges naming unknown codes
    duplicate_edges: list[tuple[str, str]] = field(default_factory=list)

    @property
    def edge_count(self) -> int:
        return sum(len(deps) for deps in self.adjacency.values())


def _clean(code) -> str:
    if not isinstance(code, str) or not code.strip():
        raise GraphValidationError(f"Course code must be a non-empty string, got {code!r}")
    return code.strip()


def build_graph(courses: Iterable[str], prerequisites: Iterable[tuple[str, str]]) -> CourseGraph:
    """Build adjacency lists in O(V + E) (plus sorting for deterministic output).

    - Duplicate course codes and self-dependencies raise GraphValidationError.
    - Duplicate edges are ignored once and reported in `duplicate_edges`.
    - Edges naming an unknown course are kept out of the adjacency lists and
      reported in `unresolved`.
    """
    known: set[str] = set()
    for raw in courses:
        code = _clean(raw)
        if code in known:
            raise GraphValidationError(f"Duplicate course code: {code}")
        known.add(code)

    adjacency = {c: [] for c in known}
    reverse = {c: [] for c in known}
    seen_edges: set[tuple[str, str]] = set()
    unresolved, duplicates = [], []

    for pre_raw, dep_raw in prerequisites:
        pre, dep = _clean(pre_raw), _clean(dep_raw)
        if pre == dep:
            raise GraphValidationError(f"Course {pre} cannot be its own prerequisite")
        if (pre, dep) in seen_edges:
            duplicates.append((pre, dep))
            continue
        seen_edges.add((pre, dep))
        missing = [c for c in (pre, dep) if c not in known]
        if missing:
            unresolved.append({"prerequisite": pre, "dependent": dep, "missing": missing})
            continue
        adjacency[pre].append(dep)
        reverse[dep].append(pre)

    for neighbours in (*adjacency.values(), *reverse.values()):
        neighbours.sort()
    return CourseGraph(sorted(known), adjacency, reverse, unresolved, duplicates)
