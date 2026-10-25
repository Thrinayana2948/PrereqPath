"""DFS-based cycle analysis, independent of Kahn's algorithm. Both DFS routines are
iterative so deep prerequisite chains cannot hit Python's recursion limit."""
from .graph import CourseGraph

WHITE, GRAY, BLACK = 0, 1, 2  # unvisited, on the current DFS path, finished


def find_cycles(graph: CourseGraph) -> list[list[str]]:
    """Three-colour DFS. An edge u -> v where v is GRAY is a back edge, which proves a
    directed cycle; the cycle is read off the current path from v to u.

    Detection is O(V + E) time, O(V) space. Reconstructing each reported cycle costs
    O(cycle length), so the output-sensitive worst case is O(V * E).
    """
    state = {v: WHITE for v in graph.vertices}
    cycles = []
    for root in graph.vertices:
        if state[root] != WHITE:
            continue
        state[root] = GRAY
        path, position = [root], {root: 0}
        stack = [(root, iter(graph.adjacency[root]))]
        while stack:
            u, neighbours = stack[-1]
            v = next(neighbours, None)
            if v is None:
                state[u] = BLACK
                stack.pop()
                path.pop()
                del position[u]
            elif state[v] == WHITE:
                state[v] = GRAY
                position[v] = len(path)
                path.append(v)
                stack.append((v, iter(graph.adjacency[v])))
            elif state[v] == GRAY:
                cycles.append(path[position[v]:] + [v])
    return cycles


def cycle_groups(graph: CourseGraph) -> list[list[str]]:
    """Tarjan's strongly connected components (DFS with unvisited / on-stack / done states).

    A course is an actual cycle member iff its SCC has more than one course (self-loops
    are rejected at build time). This is exact, unlike collecting back-edge paths, which
    can miss members reached only via cross edges. O(V + E) time, O(V) space.
    """
    index, low = {}, {}
    on_stack, stack, groups = set(), [], []
    counter = 0
    for root in graph.vertices:
        if root in index:
            continue
        index[root] = low[root] = counter
        counter += 1
        stack.append(root)
        on_stack.add(root)
        work = [(root, iter(graph.adjacency[root]))]
        while work:
            u, neighbours = work[-1]
            v = next(neighbours, None)
            if v is not None:
                if v not in index:
                    index[v] = low[v] = counter
                    counter += 1
                    stack.append(v)
                    on_stack.add(v)
                    work.append((v, iter(graph.adjacency[v])))
                elif v in on_stack:
                    low[u] = min(low[u], index[v])
                continue
            work.pop()
            if work:
                parent = work[-1][0]
                low[parent] = min(low[parent], low[u])
            if low[u] == index[u]:
                component = []
                while True:
                    w = stack.pop()
                    on_stack.discard(w)
                    component.append(w)
                    if w == u:
                        break
                if len(component) > 1:
                    groups.append(sorted(component))
    return sorted(groups)
