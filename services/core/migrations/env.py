import os

from alembic import context
from sqlalchemy import create_engine


def run():
    engine = create_engine(os.environ["CORTEX_MIGRATION_DATABASE_URL"])
    with engine.connect() as connection:
        context.configure(connection=connection)
        with context.begin_transaction():
            context.run_migrations()
    engine.dispose()


run()
