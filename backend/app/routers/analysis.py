from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session, aliased

from ..db import get_session
from ..graph import GraphValidationError, analyze
from ..models import Course, Prerequisite
from ..sample import load_sample, remove_sample
from ..schemas import CustomAnalysisIn

router = APIRouter(prefix="/api", tags=["graph & analysis"])


def _load_graph(session: Session):
    courses = session.execute(select(Course.id, Course.code, Course.name).order_by(Course.code)).all()
    pre, dep = aliased(Course), aliased(Course)
    edges = session.execute(
        select(Prerequisite.id, pre.code, dep.code)
        .join(pre, pre.id == Prerequisite.prerequisite_id)
        .join(dep, dep.id == Prerequisite.dependent_id)
        .order_by(pre.code, dep.code)
    ).all()
    return courses, edges


@router.get("/graph")
def get_graph(session: Session = Depends(get_session)):
    courses, edges = _load_graph(session)
    return {
        "nodes": [{"id": c.id, "code": c.code, "name": c.name} for c in courses],
        "edges": [{"id": e[0], "source": e[1], "target": e[2]} for e in edges],
    }


@router.get("/analysis")
def analyze_database(session: Session = Depends(get_session)):
    courses, edges = _load_graph(session)
    return analyze([c.code for c in courses], [(e[1], e[2]) for e in edges])


@router.post("/analysis/custom")
def analyze_custom(body: CustomAnalysisIn):
    """Analyse an arbitrary graph without touching the database (supports unknown codes)."""
    try:
        return analyze(body.courses, [(e.prerequisite, e.dependent) for e in body.prerequisites])
    except GraphValidationError as exc:
        raise HTTPException(422, str(exc))


@router.post("/sample/load")
def sample_load(session: Session = Depends(get_session)):
    result = load_sample(session)
    session.commit()
    return result


@router.post("/sample/reset")
def sample_reset(session: Session = Depends(get_session)):
    """Restore sample data to its original state in one transaction. Non-sample courses are kept."""
    removed = remove_sample(session)
    session.flush()
    loaded = load_sample(session)
    session.commit()
    return {**removed, **loaded}


@router.delete("/sample")
def sample_remove(session: Session = Depends(get_session)):
    result = remove_sample(session)
    session.commit()
    return result
