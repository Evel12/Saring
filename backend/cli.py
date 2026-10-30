"""Local setup: python -m backend.cli create-admin --email hr@example.test"""

import argparse, getpass, os
from sqlalchemy import select
from backend.db import Session
from backend import models as m, auth, schemas as d, services as svc


def create_admin(s, name, email, password):
    if len(password) < 12:
        raise ValueError("Use a password of at least 12 characters")
    user = s.scalar(select(m.User).where(m.User.email == email.lower()))
    if user:
        raise ValueError(
            "User already exists; add memberships through an existing administrator"
        )
    org = m.Organization(name=name, is_demo=False)
    s.add(org)
    s.flush()
    user = m.User(
        email=email.lower(),
        display_name="Administrator",
        password_hash=auth.passwords.hash(password),
    )
    s.add(user)
    s.flush()
    membership = m.Membership(org_id=org.id, user_id=user.id, role="admin")
    s.add(membership)
    s.flush()
    return org, user


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    create = sub.add_parser("create-admin")
    create.add_argument("--organization", required=True)
    create.add_argument("--email", required=True)
    args = parser.parse_args()
    password = getpass.getpass("Administrator password (12+ characters): ")
    with Session() as s:
        org, user = create_admin(s, args.organization, args.email, password)
        s.commit()
        print("Created organization " + org.id + " and administrator " + user.email)


if __name__ == "__main__":
    main()
