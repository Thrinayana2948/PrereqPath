from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import delete, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..db import get_session
from ..models import Course, Prerequisite
from ..schemas import CourseCreate, CourseOut, CourseUpdate

router = APIRouter(prefix="/api/courses", tags=["courses"])


def _counts(session: Session, column) -> dict[int, int]:
    # .all() yields (id, count) rows; dict(Result) would misuse Result.keys() as a mapping.
    return dict(session.execute(select(column, func.count()).group_by(column)).all())


def _out(course: Course, prereqs: dict[int, int], deps: dict[int, int]) -> CourseOut:
    return CourseOut(
        id=course.id, code=course.code, name=course.name, description=course.description,
        is_sample=course.is_sample, created_at=course.created_at, updated_at=course.updated_at,
        prerequisite_count=prereqs.get(course.id, 0), dependent_count=deps.get(course.id, 0),
    )


def _single_out(session: Session, course: Course) -> CourseOut:
    pre = session.scalar(select(func.count()).where(Prerequisite.dependent_id == course.id))
    dep = session.scalar(select(func.count()).where(Prerequisite.prerequisite_id == course.id))
    return _out(course, {course.id: pre}, {course.id: dep})


def _get_or_404(session: Session, course_id: int) -> Course:
    course = session.get(Course, course_id)
    if course is None:
        raise HTTPException(404, f"Course {course_id} not found")
    return course


def _ensure_code_free(session: Session, code: str, exclude_id: int | None = None) -> None:
    existing = session.scalar(select(Course.id).where(Course.code == code))
    if existing is not None and existing != exclude_id:
        raise HTTPException(409, f"Course code {code} already exists")


@router.get("", response_model=list[CourseOut])
def list_courses(session: Session = Depends(get_session)):
    courses = session.scalars(select(Course).order_by(Course.code)).all()
    prereqs = _counts(session, Prerequisite.dependent_id)
    deps = _counts(session, Prerequisite.prerequisite_id)
    return [_out(c, prereqs, deps) for c in courses]


@router.post("", response_model=CourseOut, status_code=201)
def create_course(body: CourseCreate, session: Session = Depends(get_session)):
    _ensure_code_free(session, body.code)
    course = Course(code=body.code, name=body.name, description=body.description)
    session.add(course)
    try:
        session.commit()
    except IntegrityError:  # lost a race with a concurrent insert of the same code
        session.rollback()
        raise HTTPException(409, f"Course code {body.code} already exists")
    session.refresh(course)
    return _out(course, {}, {})


@router.get("/{course_id}", response_model=CourseOut)
def get_course(course_id: int, session: Session = Depends(get_session)):
    return _single_out(session, _get_or_404(session, course_id))


@router.patch("/{course_id}", response_model=CourseOut)
def update_course(course_id: int, body: CourseUpdate, session: Session = Depends(get_session)):
    course = _get_or_404(session, course_id)
    changes = body.model_dump(exclude_unset=True)
    if "code" in changes:
        _ensure_code_free(session, changes["code"], exclude_id=course_id)
    for field, value in changes.items():
        setattr(course, field, value)
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        raise HTTPException(409, "Course code already exists")
    session.refresh(course)
    return _single_out(session, course)


@router.delete("/{course_id}")
def delete_course(
    course_id: int,
    cascade: bool = Query(False, description="Also delete every prerequisite relationship involving this course"),
    session: Session = Depends(get_session),
):
    course = _get_or_404(session, course_id)
    touches = or_(Prerequisite.prerequisite_id == course_id, Prerequisite.dependent_id == course_id)
    links = session.scalar(select(func.count()).select_from(Prerequisite).where(touches))
    if links and not cascade:
        raise HTTPException(
            409,
            f"Course {course.code} is used in {links} prerequisite relationship(s). Remove them first, "
            "or repeat the request with cascade=true to delete the course and those relationships together.",
        )
    code = course.code
    # One transaction: relationships and course are removed together or not at all.
    session.execute(delete(Prerequisite).where(touches))
    session.delete(course)
    session.commit()
    return {"deleted": code, "removed_prerequisites": links}
