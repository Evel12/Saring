from alembic import context
from backend.db import Base, engine
import backend.models


def include_object(obj, name, type_, reflected, compare_to):
    return not (type_ == "table" and name.startswith("legacy_"))


with engine.connect() as connection:
    context.configure(
        connection=connection,
        target_metadata=Base.metadata,
        include_object=include_object,
        render_as_batch=True,
    )
    with context.begin_transaction():
        context.run_migrations()
