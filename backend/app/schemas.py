import re
from datetime import datetime

from pydantic import BaseModel, Field, field_validator, model_validator

CODE_RE = re.compile(r"^[A-Z0-9][A-Z0-9_-]{0,19}$")
CODE_RULE = "1-20 characters: letters, digits, '-' or '_', starting with a letter or digit"


def normalize_code(value) -> str:
    if not isinstance(value, str):
        raise ValueError("course code must be a string")
    code = value.strip().upper()
    if not CODE_RE.fullmatch(code):
        raise ValueError(f"invalid course code {value!r}: {CODE_RULE}")
    return code


def _clean_name(value: str) -> str:
    value = value.strip()
    if not value:
        raise ValueError("name must not be blank")
    return value


def _clean_description(value: str | None) -> str | None:
    return (value.strip() or None) if isinstance(value, str) else value


class CourseCreate(BaseModel):
    code: str
    name: str = Field(max_length=200)
    description: str | None = Field(default=None, max_length=2000)

    _code = field_validator("code", mode="before")(normalize_code)
    _name = field_validator("name")(_clean_name)
    _desc = field_validator("description")(_clean_description)


class CourseUpdate(BaseModel):
    code: str | None = None
    name: str | None = Field(default=None, max_length=200)
    description: str | None = Field(default=None, max_length=2000)

    @field_validator("code", mode="before")
    @classmethod
    def _code(cls, v):
        return None if v is None else normalize_code(v)

    @field_validator("name")
    @classmethod
    def _name(cls, v):
        return None if v is None else _clean_name(v)

    _desc = field_validator("description")(_clean_description)

    @model_validator(mode="after")
    def _not_empty(self):
        if not self.model_fields_set:
            raise ValueError("provide at least one of: code, name, description")
        for required in ("code", "name"):
            if required in self.model_fields_set and getattr(self, required) is None:
                raise ValueError(f"{required} cannot be null")
        return self


class CourseOut(BaseModel):
    id: int
    code: str
    name: str
    description: str | None
    is_sample: bool
    created_at: datetime
    updated_at: datetime
    prerequisite_count: int = 0
    dependent_count: int = 0


class PrerequisiteIn(BaseModel):
    prerequisite_id: int = Field(gt=0)
    dependent_id: int = Field(gt=0)

    @model_validator(mode="after")
    def _no_self(self):
        if self.prerequisite_id == self.dependent_id:
            raise ValueError("a course cannot be its own prerequisite")
        return self


class PrerequisiteOut(BaseModel):
    id: int
    prerequisite_id: int
    prerequisite_code: str
    dependent_id: int
    dependent_code: str
    created_at: datetime


class EdgeIn(BaseModel):
    prerequisite: str
    dependent: str

    _codes = field_validator("prerequisite", "dependent", mode="before")(normalize_code)


class CustomAnalysisIn(BaseModel):
    """Stateless what-if analysis; may reference codes that are not in `courses`."""
    courses: list[str] = Field(default_factory=list, max_length=2000)
    prerequisites: list[EdgeIn] = Field(default_factory=list, max_length=10000)

    @field_validator("courses", mode="before")
    @classmethod
    def _codes(cls, v):
        return [normalize_code(c) for c in v] if isinstance(v, list) else v
