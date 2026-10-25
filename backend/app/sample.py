"""Optional DEMO curriculum for a fictional "Orbital Systems" programme. It is invented demo data,
not an official university curriculum. Loading is additive and repeatable; removal touches demo rows
only. Intentionally invalid graphs (cycles, unknown codes) belong in the what-if sandbox, not here."""
from sqlalchemy import delete, or_, select
from sqlalchemy.orm import Session

from .graph import analyze
from .models import Course, Prerequisite
from .schemas import normalize_code

_DEMO = "Demo data (fictional course)."
SAMPLE_COURSES = [
    ("ORB100", "Foundations of Orbital Mechanics", f"{_DEMO} Kepler's laws, orbits, two-body problem."),
    ("MTH110", "Applied Vector Calculus", f"{_DEMO} Vector fields, gradients, numerical integration."),
    ("CMP120", "Flight Software Basics", f"{_DEMO} Embedded programming and telemetry."),
    ("HUM105", "Space Policy and Ethics", f"{_DEMO} Independent elective with no prerequisites."),
    ("ORB200", "Trajectory Design", f"{_DEMO} Transfer orbits and launch windows."),
    ("CMP210", "Real-Time Systems", f"{_DEMO} Scheduling and deadlines on flight computers."),
    ("SNS220", "Sensor Fusion", f"{_DEMO} Combining star trackers, gyros and GPS."),
    ("PRP230", "Propulsion Dynamics", f"{_DEMO} Rocket equation and thrust profiles."),
    ("ORB310", "Rendezvous and Docking", f"{_DEMO} Relative motion and approach planning."),
    ("CMP320", "Autonomous Guidance", f"{_DEMO} On-board guidance and control loops."),
    ("PRP330", "Mission Fuel Budgeting", f"{_DEMO} Delta-v budgets and margins."),
    ("SAF340", "Spacecraft Safety Engineering", f"{_DEMO} Fault tolerance and hazard analysis."),
    ("CAP400", "Mission Design Capstone", f"{_DEMO} Team project integrating the programme."),
]

# prerequisite -> dependent. Chains of varied length, several courses with 2-4 prerequisites,
# and one independent course (HUM105).
SAMPLE_PREREQUISITES = [
    ("ORB100", "ORB200"), ("MTH110", "ORB200"),
    ("CMP120", "CMP210"),
    ("MTH110", "SNS220"), ("CMP120", "SNS220"),
    ("ORB100", "PRP230"),
    ("ORB200", "ORB310"), ("SNS220", "ORB310"),
    ("CMP210", "CMP320"), ("SNS220", "CMP320"), ("ORB200", "CMP320"),
    ("PRP230", "PRP330"), ("ORB200", "PRP330"),
    ("CMP210", "SAF340"),
    ("ORB310", "CAP400"), ("CMP320", "CAP400"), ("PRP330", "CAP400"), ("SAF340", "CAP400"),
]


def validate_sample() -> None:
    """Fail fast if the demo data is not a valid, complete, duplicate-free DAG."""
    codes = [normalize_code(code) for code, _, _ in SAMPLE_COURSES]  # format check
    if len(SAMPLE_PREREQUISITES) != len(set(SAMPLE_PREREQUISITES)):
        raise ValueError("Demo data contains duplicate prerequisite relationships")
    result = analyze(codes, SAMPLE_PREREQUISITES)  # rejects duplicate codes and self-dependencies
    if not result["summary"]["is_complete"]:
        raise ValueError("Demo data must be acyclic with every prerequisite resolved")


def load_sample(session: Session) -> dict:
    """Insert missing sample courses/links. Existing courses with the same code are left untouched
    and no sample link is attached to a non-sample course."""
    validate_sample()
    codes = [c[0] for c in SAMPLE_COURSES]
    existing = {c.code: c for c in session.scalars(select(Course).where(Course.code.in_(codes)))}
    added = 0
    for code, name, description in SAMPLE_COURSES:
        if code not in existing:
            course = Course(code=code, name=name, description=description, is_sample=True)
            session.add(course)
            existing[code] = course
            added += 1
    session.flush()

    sample_ids = {code: c.id for code, c in existing.items() if c.is_sample}
    present = set(session.execute(
        select(Prerequisite.prerequisite_id, Prerequisite.dependent_id)
        .where(Prerequisite.dependent_id.in_(sample_ids.values()))
    ).tuples())
    links_added = links_skipped = 0
    for pre, dep in SAMPLE_PREREQUISITES:
        pair = (sample_ids.get(pre), sample_ids.get(dep))
        if None in pair or pair in present:
            links_skipped += 1
            continue
        session.add(Prerequisite(prerequisite_id=pair[0], dependent_id=pair[1]))
        links_added += 1
    return {
        "courses_added": added,
        "courses_skipped": len(SAMPLE_COURSES) - added,
        "prerequisites_added": links_added,
        "prerequisites_skipped": links_skipped,
    }


def remove_sample(session: Session) -> dict:
    """Delete sample courses and every relationship that touches them (explicitly, not via FK cascade)."""
    ids = list(session.scalars(select(Course.id).where(Course.is_sample)))
    if not ids:
        return {"courses_removed": 0, "prerequisites_removed": 0}
    links = session.execute(delete(Prerequisite).where(
        or_(Prerequisite.prerequisite_id.in_(ids), Prerequisite.dependent_id.in_(ids))
    )).rowcount
    session.execute(delete(Course).where(Course.id.in_(ids)))
    return {"courses_removed": len(ids), "prerequisites_removed": links}
