from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, aliased

from ..db import get_session
from ..models import Course, Prerequisite
from ..schemas import PrerequisiteIn, PrerequisiteOut

router = APIRouter(prefix="/api/prerequisites", tags=["prerequisites"])

Pre, Dep = aliased(Course), aliased(Course)


def _query():
    return (
        select(Prerequisite.id, Prerequisite.prerequisite_id, Pre.code.label("prerequisite_code"),
               Prerequisite.dependent_id, Dep.code.label("dependent_code"), Prerequisite.created_at)
        .join(Pre, Pre.id == Prerequisite.prerequisite_id)
        .join(Dep, Dep.id == Prerequisite.dependent_id)
    )


def _fetch(session: Session, link_id: int) -> PrerequisiteOut:
    row = session.execute(_query().where(Prerequisite.id == link_id)).mappings().one()
    return PrerequisiteOut(**row)


def _validate(session: Session, body: PrerequisiteIn, exclude_id: int | None = None) -> None:
    for label, cid in (("Prerequisite", body.prerequisite_id), ("Dependent", body.dependent_id)):
        if session.get(Course, cid) is None:
            raise HTTPException(404, f"{label} course {cid} not found")
    existing = session.scalar(select(Prerequisite.id).where(
        Prerequisite.prerequisite_id == body.prerequisite_id,
        Prerequisite.dependent_id == body.dependent_id,
    ))
    if existing is not None and existing != exclude_id:
        raise HTTPException(409, "This prerequisite relationship already exists")


def _commit(session: Session) -> None:
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        raise HTTPException(409, "Relationship conflicts with an existing one or references a missing course")


@router.get("", response_model=list[PrerequisiteOut])
def list_prerequisites(session: Session = Depends(get_session)):
    rows = session.execute(_query().order_by(Dep.code, Pre.code)).mappings()
    return [PrerequisiteOut(**r) for r in rows]


@router.post("", response_model=PrerequisiteOut, status_code=201)
def create_prerequisite(body: PrerequisiteIn, session: Session = Depends(get_session)):
    _validate(session, body)
    link = Prerequisite(prerequisite_id=body.prerequisite_id, dependent_id=body.dependent_id)
    session.add(link)
    _commit(session)
    return _fetch(session, link.id)


@router.put("/{link_id}", response_model=PrerequisiteOut)
def update_prerequisite(link_id: int, body: PrerequisiteIn, session: Session = Depends(get_session)):
    link = session.get(Prerequisite, link_id)
    if link is None:
        raise HTTPException(404, f"Prerequisite relationship {link_id} not found")
    _validate(session, body, exclude_id=link_id)
    link.prerequisite_id, link.dependent_id = body.prerequisite_id, body.dependent_id
    _commit(session)
    return _fetch(session, link_id)


@router.delete("/{link_id}", status_code=204)
def delete_prerequisite(link_id: int, session: Session = Depends(get_session)):
    link = session.get(Prerequisite, link_id)
    if link is None:
        raise HTTPException(404, f"Prerequisite relationship {link_id} not found")
    session.delete(link)
    session.commit()
    return Response(status_code=204)
