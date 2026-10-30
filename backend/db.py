"""Database configuration shared by API, CLI, migrations and worker."""

import os
from datetime import datetime, timezone
from uuid import uuid4
from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, sessionmaker


def now():
    return datetime.now(timezone.utc).timestamp()


def uid():
    return str(uuid4())


url = os.getenv("DATABASE_URL", "sqlite:///./saring.db")
engine = create_engine(
    url,
    **(
        {"connect_args": {"check_same_thread": False, "timeout": 30}}
        if url.startswith("sqlite:")
        else {"pool_pre_ping": True}
    )
)
if url.startswith("sqlite:"):

    @event.listens_for(engine, "connect")
    def sqlite_settings(connection, record):
        connection.execute("PRAGMA foreign_keys=ON")
        connection.execute("PRAGMA busy_timeout=30000")


Session = sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def get_db():
    with Session() as session:
        yield session
