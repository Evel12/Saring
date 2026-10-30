import os
from datetime import datetime, timezone
from uuid import uuid4
from sqlalchemy import create_engine, String, Text, JSON, Integer, Float
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker

def now(): return datetime.now(timezone.utc).timestamp()
def uid(): return str(uuid4())
# Frozen legacy metadata, retained only for revisions 001 and 002.
class Base(DeclarativeBase): pass
class Vacancy(Base):
    __tablename__='vacancies'
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    owner: Mapped[str] = mapped_column(String, index=True)
    title: Mapped[str] = mapped_column(String)
    requirements: Mapped[list] = mapped_column(JSON, default=list)
    approved: Mapped[int] = mapped_column(Integer, default=0)
    stage: Mapped[int] = mapped_column(Integer, default=0)
class Candidate(Base):
    __tablename__='candidates'
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    vacancy_id: Mapped[str] = mapped_column(String, index=True)
    name: Mapped[str] = mapped_column(String)
    file: Mapped[str] = mapped_column(String, default='')
    storage_key: Mapped[str] = mapped_column(String, default='')
    evidence: Mapped[list] = mapped_column(JSON, default=list)
    sources: Mapped[list] = mapped_column(JSON, default=list)
    questions: Mapped[list] = mapped_column(JSON, default=list)
    status: Mapped[str] = mapped_column(String, default='ready')
    decision: Mapped[str] = mapped_column(String, default='undecided')
    portal_hash: Mapped[str] = mapped_column(String, default='')
    portal_expires: Mapped[float] = mapped_column(Float, default=0)
    rounds: Mapped[int] = mapped_column(Integer, default=0)
    booking: Mapped[dict] = mapped_column(JSON, default=dict)
class Job(Base):
    __tablename__='jobs'
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    vacancy_id: Mapped[str] = mapped_column(String, index=True)
    status: Mapped[str] = mapped_column(String, default='queued')
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    lease_until: Mapped[float] = mapped_column(Float, default=0)
    available_at: Mapped[float] = mapped_column(Float, default=now)
    error: Mapped[str] = mapped_column(String, default='')
    kind: Mapped[str] = mapped_column(String, default='review')
    candidate_id: Mapped[str] = mapped_column(String, default='')
class Activity(Base):
    __tablename__='activities'
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    vacancy_id: Mapped[str] = mapped_column(String, index=True)
    created: Mapped[float] = mapped_column(Float, default=now)
    kind: Mapped[str] = mapped_column(String)
    message: Mapped[str] = mapped_column(Text)
def audit(s, v, kind, message): s.add(Activity(vacancy_id=v,kind=kind,message=message))
